package com.aleisteralvear.newsie.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.aleisteralvear.newsie.data.repository.NewsieRepository
import com.aleisteralvear.newsie.data.repository.SourcePreviewResult
import com.aleisteralvear.newsie.domain.models.AppPreferences
import com.aleisteralvear.newsie.domain.models.Article
import com.aleisteralvear.newsie.domain.models.Category
import com.aleisteralvear.newsie.domain.models.DefaultSeedData
import com.aleisteralvear.newsie.domain.models.DirectorySourceEntry
import com.aleisteralvear.newsie.domain.models.FeedFormat
import com.aleisteralvear.newsie.domain.models.NavTab
import com.aleisteralvear.newsie.domain.models.NewsSource
import com.aleisteralvear.newsie.domain.models.PrivateAccessStatus
import com.aleisteralvear.newsie.domain.models.ReadingHistoryEntry
import com.aleisteralvear.newsie.domain.models.RefreshState
import com.aleisteralvear.newsie.domain.models.SavedFeedConfig
import com.aleisteralvear.newsie.domain.models.SearchScope
import com.aleisteralvear.newsie.domain.models.SortOrder
import com.aleisteralvear.newsie.domain.models.WorkspaceAuthMethod
import com.aleisteralvear.newsie.domain.models.WorkspaceSummary
import com.aleisteralvear.newsie.security.biometric.BiometricCapabilityStatus
import com.aleisteralvear.newsie.security.biometric.NativeBiometricAuthManager
import com.aleisteralvear.newsie.security.keystore.BiometricKeyInvalidatedException
import com.aleisteralvear.newsie.security.keystore.KeystoreProvider
import com.aleisteralvear.newsie.security.workspaces.WorkspaceLockedException
import com.aleisteralvear.newsie.security.workspaces.WorkspaceVaultManager
import com.aleisteralvear.newsie.workers.FeedSyncWorker
import com.aleisteralvear.newsie.workers.NewsieNotificationManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.crypto.Cipher

data class NewsieUiState(
    val activeWorkspaceId: String = DefaultSeedData.DEFAULT_WORKSPACE_ID,
    val activeWorkspaceIsPrivate: Boolean = false,
    val activeWorkspaceLocked: Boolean = false,
    val activeTab: NavTab = NavTab.HOME,
    val preferences: AppPreferences = AppPreferences(),
    val categories: List<Category> = DefaultSeedData.defaultCategories,
    val selectedCategoryId: String = DefaultSeedData.ALL_NEWS_CATEGORY_ID,
    val articles: List<Article> = emptyList(),
    val totalArticles: Int = 0,
    val hasMoreArticles: Boolean = false,
    val isLoadingMore: Boolean = false,
    val loadError: String? = null,
    val sources: List<NewsSource> = emptyList(),
    val directory: List<DirectorySourceEntry> = DefaultSeedData.curatedDirectory,
    val savedFeedConfigs: List<SavedFeedConfig> = emptyList(),
    val bookmarkedArticles: List<Article> = emptyList(),
    val readingHistory: List<ReadingHistoryEntry> = emptyList(),
    val searchQuery: String = "",
    val searchScope: SearchScope = SearchScope.CACHED,
    val searchSelectedSourceIds: Set<String> = emptySet(),
    val searchResults: List<Article> = emptyList(),
    val searchHistory: List<String> = emptyList(),
    val selectedArticle: Article? = null,
    val refreshState: RefreshState = RefreshState(),
    val showCategoryManager: Boolean = false,
    // Private workspace UI controls (never populated with workspace names before authentication)
    val privateAccessStatus: PrivateAccessStatus = PrivateAccessStatus(),
    val showPrivateAuthModal: Boolean = false,
    val showPrivateDashboard: Boolean = false,
    val showUnlockTargetModal: WorkspaceSummary? = null,
    val showCreateWorkspaceModal: Boolean = false,
    val dashboardWorkspaces: List<WorkspaceSummary> = emptyList(),
    val authError: String? = null,
    val authBusy: Boolean = false,
    val authCooldownSeconds: Int = 0,
    val dashboardNotice: String? = null,
    val biometricCapability: BiometricCapabilityStatus = BiometricCapabilityStatus.NO_HARDWARE,
    val isPrivacyScreenBlurred: Boolean = false,
    // Source preview & testing feedback
    val sourcePreview: SourcePreviewResult? = null,
    val sourceActionMessage: String? = null,
    val sourceActionError: String? = null,
    val sourceActionBusy: Boolean = false,
) {
    /**
     * FLAG_SECURE MUST guard any screen displaying private workspace authentication,
     * Private Dashboard metadata, or unlocked private workspace content.
     */
    val requiresFlagSecure: Boolean
        get() = showPrivateDashboard ||
            showPrivateAuthModal ||
            showUnlockTargetModal != null ||
            showCreateWorkspaceModal ||
            activeWorkspaceIsPrivate
}

class NewsieViewModel(
    private val appContext: Context,
    private val repository: NewsieRepository,
    val vaultManager: WorkspaceVaultManager,
    val keystoreProvider: KeystoreProvider,
) : ViewModel() {

    private val _uiState = MutableStateFlow(NewsieUiState())
    val uiState: StateFlow<NewsieUiState> = _uiState.asStateFlow()

    private var inactivityJob: Job? = null
    private var backgroundGraceJob: Job? = null
    private var cooldownJob: Job? = null

    init {
        viewModelScope.launch {
            repository.ensurePublicBaselineSeeded()
            refreshAccessAndCapability()
            hydrateWorkspace(DefaultSeedData.DEFAULT_WORKSPACE_ID)
            FeedSyncWorker.scheduleFromPreferences(appContext, _uiState.value.preferences)
        }
        startInactivityMonitor()
    }

    fun refreshAccessAndCapability() {
        viewModelScope.launch {
            val status = vaultManager.getPublicPrivateAccessStatus()
            val bioCap = NativeBiometricAuthManager.checkCapability(appContext)
            _uiState.update {
                it.copy(
                    privateAccessStatus = status,
                    biometricCapability = bioCap,
                )
            }
        }
    }

    private fun startInactivityMonitor() {
        inactivityJob?.cancel()
        inactivityJob = viewModelScope.launch {
            while (true) {
                delay(15_000L)
                val lockedIds = vaultManager.enforceInactivityTimeouts()
                if (lockedIds.isNotEmpty()) {
                    val activeId = _uiState.value.activeWorkspaceId
                    if (activeId in lockedIds) {
                        clearSensitiveUiStateOnLock(activeId)
                    } else if (_uiState.value.showPrivateDashboard) {
                        reloadDashboardWorkspaces()
                    }
                }
            }
        }
    }

    fun onUserInteraction() {
        val activeId = _uiState.value.activeWorkspaceId
        if (activeId != DefaultSeedData.DEFAULT_WORKSPACE_ID) {
            vaultManager.recordUserActivity(activeId)
        }
    }

    fun onAppBackgrounded() {
        val state = _uiState.value
        val inPrivateContext = state.activeWorkspaceIsPrivate || state.showPrivateDashboard
        if (!inPrivateContext) return

        if (state.preferences.privacyScreenEnabled) {
            _uiState.update { it.copy(isPrivacyScreenBlurred = true) }
        }

        // Lock active private workspace and exit dashboard automatically after 10-second background grace
        backgroundGraceJob?.cancel()
        backgroundGraceJob = viewModelScope.launch {
            delay(10_000L)
            lockAllAndReturnPublic()
        }
    }

    fun onAppForegrounded() {
        backgroundGraceJob?.cancel()
        refreshAccessAndCapability()
    }

    fun onScreenLocked() {
        backgroundGraceJob?.cancel()
        if (_uiState.value.requiresFlagSecure) {
            lockAllAndReturnPublic()
        }
    }

    fun dismissPrivacyBlur() {
        _uiState.update { it.copy(isPrivacyScreenBlurred = false) }
    }

    fun selectNavTab(tab: NavTab) {
        onUserInteraction()
        _uiState.update {
            it.copy(
                activeTab = tab,
                showPrivateDashboard = false,
                selectedArticle = null,
            )
        }
    }

    fun requestPrivateAccessEntry() {
        viewModelScope.launch {
            val status = vaultManager.getPublicPrivateAccessStatus()
            val bioCap = NativeBiometricAuthManager.checkCapability(appContext)
            if (vaultManager.isDashboardAuthenticated() && status.hasPrivateWorkspaces) {
                reloadDashboardWorkspaces()
                _uiState.update {
                    it.copy(
                        privateAccessStatus = status,
                        biometricCapability = bioCap,
                        showPrivateDashboard = true,
                        showPrivateAuthModal = false,
                    )
                }
            } else {
                _uiState.update {
                    it.copy(
                        privateAccessStatus = status,
                        biometricCapability = bioCap,
                        showPrivateAuthModal = true,
                        authError = null,
                    )
                }
            }
        }
    }

    fun dismissPrivateAuthModal() {
        _uiState.update {
            it.copy(
                showPrivateAuthModal = false,
                authError = null,
                authBusy = false,
            )
        }
    }

    fun createFirstWorkspaceFromGate(
        displayName: String,
        passphrase: String,
        autoLockMinutes: Int,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.createPrivateWorkspace(
                    displayName = displayName,
                    rawPassphrase = passphrase,
                    autoLockMinutes = autoLockMinutes,
                    authenticateDashboard = true,
                )
                val status = vaultManager.getPublicPrivateAccessStatus()
                val workspaces = vaultManager.listPrivateWorkspacesForDashboard()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        showPrivateAuthModal = false,
                        showPrivateDashboard = true,
                        dashboardWorkspaces = workspaces,
                        privateAccessStatus = status,
                        dashboardNotice = "Private workspace initialized with AES-256-GCM & Argon2id.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update {
                    it.copy(authBusy = false, authError = ex.message ?: "Unable to create workspace.")
                }
            }
        }
    }

    fun authenticatePrivateGateWithPassphrase(passphrase: String) {
        if (_uiState.value.authCooldownSeconds > 0) return
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.authenticateDashboardWithPassphrase(passphrase)
                val workspaces = vaultManager.listPrivateWorkspacesForDashboard()
                val status = vaultManager.getPublicPrivateAccessStatus()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        showPrivateAuthModal = false,
                        showPrivateDashboard = true,
                        dashboardWorkspaces = workspaces,
                        privateAccessStatus = status,
                        authError = null,
                    )
                }
            } catch (ex: Exception) {
                startAuthCooldown(ex)
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        authError = ex.message ?: "Authentication failed.",
                    )
                }
            }
        }
    }

    suspend fun findFirstBiometricWorkspaceForGate(): String? {
        val status = vaultManager.getPublicPrivateAccessStatus()
        if (!status.hasAnyBiometricKeys) return null
        return vaultManager.getBiometricTargetWorkspaceIdForGate()
    }

    fun createWorkspaceFromDashboard(
        displayName: String,
        passphrase: String,
        autoLockMinutes: Int,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.createPrivateWorkspace(
                    displayName = displayName,
                    rawPassphrase = passphrase,
                    autoLockMinutes = autoLockMinutes,
                    authenticateDashboard = true,
                )
                reloadDashboardWorkspaces()
                val status = vaultManager.getPublicPrivateAccessStatus()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        showCreateWorkspaceModal = false,
                        privateAccessStatus = status,
                        dashboardNotice = "Private workspace created cleanly.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update {
                    it.copy(authBusy = false, authError = ex.message ?: "Creation failed.")
                }
            }
        }
    }

    fun openWorkspaceFromDashboard(workspace: WorkspaceSummary) {
        if (workspace.isLocked) {
            _uiState.update {
                it.copy(
                    showUnlockTargetModal = workspace,
                    authError = null,
                )
            }
        } else {
            viewModelScope.launch {
                hydrateWorkspace(workspace.id)
                _uiState.update {
                    it.copy(
                        showPrivateDashboard = false,
                        showUnlockTargetModal = null,
                        activeTab = NavTab.HOME,
                    )
                }
            }
        }
    }

    fun unlockTargetWithPassphrase(
        workspaceId: String,
        passphrase: String,
        isRecovery: Boolean = false,
    ) {
        if (_uiState.value.authCooldownSeconds > 0) return
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                if (isRecovery) {
                    vaultManager.recoverOrRevertToPassphrasePolicy(workspaceId, passphrase)
                } else {
                    vaultManager.unlockWorkspaceWithPassphrase(workspaceId, passphrase)
                }
                hydrateWorkspace(workspaceId)
                reloadDashboardWorkspaces()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        showUnlockTargetModal = null,
                        showPrivateDashboard = false,
                        activeTab = NavTab.HOME,
                        dashboardNotice = if (isRecovery) {
                            "Recovered via passphrase; stale biometric key cleared."
                        } else null,
                    )
                }
            } catch (ex: Exception) {
                startAuthCooldown(ex)
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        authError = ex.message ?: "Unlock failed.",
                    )
                }
            }
        }
    }

    fun unlockTargetWithBiometricCipher(workspaceId: String, cipher: Cipher) {
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.unlockWorkspaceWithBiometric(workspaceId, cipher)
                hydrateWorkspace(workspaceId)
                reloadDashboardWorkspaces()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        showUnlockTargetModal = null,
                        showPrivateDashboard = false,
                        activeTab = NavTab.HOME,
                    )
                }
            } catch (ex: BiometricKeyInvalidatedException) {
                reloadDashboardWorkspaces()
                _uiState.update {
                    it.copy(authBusy = false, authError = ex.message)
                }
            } catch (ex: Exception) {
                _uiState.update {
                    it.copy(authBusy = false, authError = ex.message ?: "Biometric unlock failed.")
                }
            }
        }
    }

    fun unlockTargetWithBothFactors(
        workspaceId: String,
        passphrase: String,
        cipher: Cipher,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.unlockWorkspaceWithBothFactors(workspaceId, passphrase, cipher)
                hydrateWorkspace(workspaceId)
                reloadDashboardWorkspaces()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        showUnlockTargetModal = null,
                        showPrivateDashboard = false,
                        activeTab = NavTab.HOME,
                    )
                }
            } catch (ex: Exception) {
                startAuthCooldown(ex)
                _uiState.update {
                    it.copy(authBusy = false, authError = ex.message ?: "Multi-factor verification failed.")
                }
            }
        }
    }

    fun completeBiometricDashboardGate(workspaceId: String, cipher: Cipher) {
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.authenticateDashboardWithBiometric(workspaceId, cipher)
                val workspaces = vaultManager.listPrivateWorkspacesForDashboard()
                val status = vaultManager.getPublicPrivateAccessStatus()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        showPrivateAuthModal = false,
                        showPrivateDashboard = true,
                        dashboardWorkspaces = workspaces,
                        privateAccessStatus = status,
                    )
                }
            } catch (ex: Exception) {
                _uiState.update {
                    it.copy(authBusy = false, authError = ex.message ?: "Biometric gate check failed.")
                }
            }
        }
    }

    fun lockSpecificWorkspace(workspaceId: String) {
        vaultManager.lockWorkspace(workspaceId)
        viewModelScope.launch {
            if (_uiState.value.activeWorkspaceId == workspaceId) {
                clearSensitiveUiStateOnLock(workspaceId)
            }
            if (_uiState.value.showPrivateDashboard) {
                reloadDashboardWorkspaces()
            }
        }
    }

    fun lockAllAndReturnPublic() {
        backgroundGraceJob?.cancel()
        vaultManager.lockAll()
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    activeWorkspaceId = DefaultSeedData.DEFAULT_WORKSPACE_ID,
                    activeWorkspaceIsPrivate = false,
                    activeWorkspaceLocked = false,
                    showPrivateDashboard = false,
                    showPrivateAuthModal = false,
                    showUnlockTargetModal = null,
                    showCreateWorkspaceModal = false,
                    dashboardWorkspaces = emptyList(),
                    isPrivacyScreenBlurred = false,
                    selectedArticle = null,
                    articles = emptyList(),
                    sources = emptyList(),
                    bookmarkedArticles = emptyList(),
                    readingHistory = emptyList(),
                    searchResults = emptyList(),
                    searchHistory = emptyList(),
                    searchQuery = "",
                    activeTab = NavTab.HOME,
                )
            }
            hydrateWorkspace(DefaultSeedData.DEFAULT_WORKSPACE_ID)
        }
    }

    fun switchToPublicWorkspace() {
        viewModelScope.launch {
            vaultManager.exitDashboardView()
            _uiState.update {
                it.copy(
                    showPrivateDashboard = false,
                    showUnlockTargetModal = null,
                    isPrivacyScreenBlurred = false,
                    activeTab = NavTab.HOME,
                )
            }
            hydrateWorkspace(DefaultSeedData.DEFAULT_WORKSPACE_ID)
        }
    }

    fun renameWorkspace(workspaceId: String, newName: String) {
        viewModelScope.launch {
            try {
                vaultManager.renameWorkspace(workspaceId, newName)
                reloadDashboardWorkspaces()
                _uiState.update { it.copy(dashboardNotice = "Workspace renamed.") }
            } catch (ex: Exception) {
                _uiState.update { it.copy(authError = ex.message) }
            }
        }
    }

    fun updateWorkspaceAutoLock(workspaceId: String, minutes: Int) {
        viewModelScope.launch {
            try {
                vaultManager.updateAutoLockMinutes(workspaceId, minutes)
                reloadDashboardWorkspaces()
                _uiState.update { it.copy(dashboardNotice = "Auto-lock interval updated.") }
            } catch (ex: Exception) {
                _uiState.update { it.copy(authError = ex.message) }
            }
        }
    }

    fun enrollBiometricWithCipher(
        workspaceId: String,
        encryptCipher: Cipher,
        targetMethod: WorkspaceAuthMethod,
    ) {
        viewModelScope.launch {
            try {
                vaultManager.enrollBiometricKey(workspaceId, encryptCipher, targetMethod)
                reloadDashboardWorkspaces()
                val status = vaultManager.getPublicPrivateAccessStatus()
                _uiState.update {
                    it.copy(
                        privateAccessStatus = status,
                        dashboardNotice = "Biometric Keystore binding updated.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update { it.copy(authError = ex.message ?: "Failed to enroll biometrics.") }
            }
        }
    }

    fun rotateWorkspacePassphrase(
        workspaceId: String,
        currentPass: String,
        newPass: String,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.rotatePassphraseAndRekey(
                    workspaceId = workspaceId,
                    currentRawPassphrase = currentPass,
                    newRawPassphrase = newPass,
                    rotateDek = true,
                )
                reloadDashboardWorkspaces()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        dashboardNotice = "Passphrase and 256-bit DEK rotated cleanly.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update { it.copy(authBusy = false, authError = ex.message) }
            }
        }
    }

    fun deleteWorkspace(
        workspaceId: String,
        passphrase: String,
        biometricCipher: Cipher? = null,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(authBusy = true, authError = null) }
            try {
                vaultManager.deletePrivateWorkspace(workspaceId, passphrase, biometricCipher)
                val wasActive = _uiState.value.activeWorkspaceId == workspaceId
                if (wasActive) {
                    hydrateWorkspace(DefaultSeedData.DEFAULT_WORKSPACE_ID)
                }
                reloadDashboardWorkspaces()
                val status = vaultManager.getPublicPrivateAccessStatus()
                _uiState.update {
                    it.copy(
                        authBusy = false,
                        privateAccessStatus = status,
                        dashboardNotice = "Private workspace and all encrypted records permanently wiped.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update { it.copy(authBusy = false, authError = ex.message) }
            }
        }
    }

    fun updateMethodASearchPhrase(newPhrase: String?) {
        viewModelScope.launch {
            try {
                val status = vaultManager.setSearchAccessPhrase(newPhrase)
                _uiState.update {
                    it.copy(
                        privateAccessStatus = status,
                        dashboardNotice = if (newPhrase == null) {
                            "Search entry phrase removed."
                        } else {
                            "Search entry phrase stored with Argon2id."
                        },
                    )
                }
            } catch (ex: Exception) {
                _uiState.update { it.copy(authError = ex.message) }
            }
        }
    }

    fun updateDoubleTapInterval(intervalMs: Int) {
        viewModelScope.launch {
            try {
                val status = vaultManager.setDoubleTapIntervalMs(intervalMs)
                _uiState.update {
                    it.copy(
                        privateAccessStatus = status,
                        dashboardNotice = "Double-tap window updated to ${status.doubleTapIntervalMs}ms.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update { it.copy(authError = ex.message) }
            }
        }
    }

    fun setCreateWorkspaceModalOpen(open: Boolean) {
        _uiState.update { it.copy(showCreateWorkspaceModal = open, authError = null) }
    }

    fun dismissUnlockModal() {
        _uiState.update { it.copy(showUnlockTargetModal = null, authError = null) }
    }

    fun clearDashboardNotice() {
        _uiState.update { it.copy(dashboardNotice = null, authError = null) }
    }

    fun reportAuthError(message: String) {
        _uiState.update { it.copy(authBusy = false, authError = message) }
    }

    // ─── News Feed, Search, Bookmarks, Sources, Categories & Settings ─────────────────────────

    private suspend fun hydrateWorkspace(workspaceId: String) {
        val isPrivate = workspaceId != DefaultSeedData.DEFAULT_WORKSPACE_ID
        if (isPrivate && !vaultManager.isWorkspaceUnlocked(workspaceId)) {
            clearSensitiveUiStateOnLock(workspaceId)
            return
        }

        try {
            val prefs = repository.getPreferences(workspaceId)
            val cats = repository.getCategories(workspaceId)
            val srcs = repository.getSources(workspaceId)
            val configs = repository.getSavedFeedConfigs(workspaceId)
            val bookmarks = repository.getBookmarkedArticles(workspaceId)
            val readingHist = repository.getReadingHistory(workspaceId)
            val searchHist = repository.getSearchHistory(workspaceId)
            val page = repository.getArticlesPage(
                workspaceId = workspaceId,
                categoryId = DefaultSeedData.ALL_NEWS_CATEGORY_ID,
                sortOrder = prefs.sortOrder,
                limit = prefs.articlesPerPage,
                offset = 0,
            )

            _uiState.update {
                it.copy(
                    activeWorkspaceId = workspaceId,
                    activeWorkspaceIsPrivate = isPrivate,
                    activeWorkspaceLocked = false,
                    preferences = prefs,
                    categories = cats,
                    selectedCategoryId = DefaultSeedData.ALL_NEWS_CATEGORY_ID,
                    sources = srcs,
                    savedFeedConfigs = configs,
                    bookmarkedArticles = bookmarks,
                    readingHistory = readingHist,
                    searchHistory = searchHist,
                    searchQuery = "",
                    searchResults = emptyList(),
                    articles = page.items,
                    totalArticles = page.totalCount,
                    hasMoreArticles = page.hasMore,
                    loadError = null,
                    selectedArticle = null,
                )
            }
        } catch (_: WorkspaceLockedException) {
            clearSensitiveUiStateOnLock(workspaceId)
        }
    }

    private fun clearSensitiveUiStateOnLock(workspaceId: String) {
        _uiState.update {
            it.copy(
                activeWorkspaceLocked = workspaceId != DefaultSeedData.DEFAULT_WORKSPACE_ID,
                articles = emptyList(),
                totalArticles = 0,
                hasMoreArticles = false,
                sources = emptyList(),
                bookmarkedArticles = emptyList(),
                readingHistory = emptyList(),
                searchResults = emptyList(),
                searchHistory = emptyList(),
                searchQuery = "",
                selectedArticle = null,
            )
        }
    }

    private suspend fun reloadDashboardWorkspaces() {
        if (!vaultManager.isDashboardAuthenticated()) return
        val list = vaultManager.listPrivateWorkspacesForDashboard()
        _uiState.update { it.copy(dashboardWorkspaces = list) }
    }

    fun selectCategory(categoryId: String) {
        onUserInteraction()
        val state = _uiState.value
        _uiState.update { it.copy(selectedCategoryId = categoryId) }
        viewModelScope.launch {
            loadFeedPage(state.activeWorkspaceId, categoryId, state.preferences, append = false)
        }
    }

    fun changeSortOrder(sortOrder: SortOrder) {
        updatePreferences { it.copy(sortOrder = sortOrder) }
    }

    fun loadMoreArticles() {
        onUserInteraction()
        val state = _uiState.value
        if (state.isLoadingMore || !state.hasMoreArticles) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingMore = true) }
            loadFeedPage(
                workspaceId = state.activeWorkspaceId,
                categoryId = state.selectedCategoryId,
                prefs = state.preferences,
                append = true,
            )
            _uiState.update { it.copy(isLoadingMore = false) }
        }
    }

    fun refreshFeeds() {
        onUserInteraction()
        val state = _uiState.value
        if (state.refreshState.isRefreshing) return
        if (state.activeWorkspaceIsPrivate && !vaultManager.isWorkspaceUnlocked(state.activeWorkspaceId)) return

        viewModelScope.launch {
            _uiState.update {
                it.copy(refreshState = it.refreshState.copy(isRefreshing = true, statusMessage = null))
            }
            val report = repository.syncWorkspace(state.activeWorkspaceId)
            val refreshedSources = repository.getSources(state.activeWorkspaceId)
            loadFeedPage(
                workspaceId = state.activeWorkspaceId,
                categoryId = state.selectedCategoryId,
                prefs = state.preferences,
                append = false,
            )

            val summary = when {
                report.totalSourcesChecked == 0 ->
                    "Sample archive active — subscribe to live RSS feeds in Sources"
                report.insertedArticles > 0 ->
                    "Added ${report.insertedArticles} new ${if (report.insertedArticles == 1) "story" else "stories"}"
                report.failedSources > 0 ->
                    "${report.failedSources} feed(s) returned errors"
                else -> "Feeds up to date"
            }

            if (!state.activeWorkspaceIsPrivate &&
                report.insertedArticles > 0 &&
                (state.preferences.breakingNotifications || state.preferences.categoryNotifications)
            ) {
                NewsieNotificationManager.notifyPublicFeedUpdates(
                    appContext,
                    report.insertedArticles,
                    state.preferences.breakingNotifications,
                )
            }

            _uiState.update {
                it.copy(
                    sources = refreshedSources,
                    refreshState = RefreshState(
                        isRefreshing = false,
                        lastRefreshedEpochMs = System.currentTimeMillis(),
                        lastRefreshedLabel = "Synced just now",
                        statusMessage = summary,
                    ),
                )
            }
        }
    }

    private suspend fun loadFeedPage(
        workspaceId: String,
        categoryId: String,
        prefs: AppPreferences,
        append: Boolean,
    ) {
        try {
            val offset = if (append) _uiState.value.articles.size else 0
            val page = repository.getArticlesPage(
                workspaceId = workspaceId,
                categoryId = categoryId,
                sortOrder = prefs.sortOrder,
                limit = prefs.articlesPerPage,
                offset = offset,
            )
            _uiState.update { current ->
                current.copy(
                    articles = if (append) current.articles + page.items else page.items,
                    totalArticles = page.totalCount,
                    hasMoreArticles = page.hasMore,
                    loadError = null,
                )
            }
        } catch (ex: Exception) {
            _uiState.update { it.copy(loadError = ex.message ?: "Unable to load articles.") }
        }
    }

    fun onSearchQueryChange(newQuery: String) {
        onUserInteraction()
        val bounded = if (newQuery.length > 1024) newQuery.take(1024) else newQuery
        _uiState.update { it.copy(searchQuery = bounded) }
        val state = _uiState.value
        val trimmed = bounded.trim()
        if (trimmed.isEmpty()) {
            _uiState.update { it.copy(searchResults = emptyList()) }
            return
        }
        viewModelScope.launch {
            val results = repository.searchArticles(
                workspaceId = state.activeWorkspaceId,
                query = trimmed,
                scope = state.searchScope,
                selectedSourceIds = state.searchSelectedSourceIds,
            )
            _uiState.update { it.copy(searchResults = results) }
        }
    }

    /**
     * Method A Private Access Interception:
     * 1) Checks raw input locally via Argon2id NFC-normalized verifier BEFORE search index, history, or network.
     * 2) Clears search input immediately if matched and triggers Private Access Verification.
     * 3) Never persists matching access phrases into search history.
     */
    fun submitSearch(rawInput: String) {
        onUserInteraction()
        viewModelScope.launch {
            val state = _uiState.value
            if (state.privateAccessStatus.hasSearchPassphrase &&
                vaultManager.checkSearchAccessPhrase(rawInput)
            ) {
                _uiState.update {
                    it.copy(
                        searchQuery = "",
                        searchResults = emptyList(),
                    )
                }
                requestPrivateAccessEntry()
                return@launch
            }

            val trimmed = rawInput.trim()
            if (trimmed.isEmpty()) return@launch
            val hist = repository.addSearchHistoryTerm(state.activeWorkspaceId, trimmed)
            val results = repository.searchArticles(
                workspaceId = state.activeWorkspaceId,
                query = trimmed,
                scope = state.searchScope,
                selectedSourceIds = state.searchSelectedSourceIds,
            )
            _uiState.update {
                it.copy(
                    searchHistory = hist,
                    searchResults = results,
                )
            }
        }
    }

    fun updateSearchScope(scope: SearchScope) {
        onUserInteraction()
        _uiState.update { it.copy(searchScope = scope) }
        val query = _uiState.value.searchQuery
        if (query.isNotBlank()) onSearchQueryChange(query)
    }

    fun toggleSearchSelectedSource(sourceId: String) {
        onUserInteraction()
        _uiState.update { current ->
            val next = if (sourceId in current.searchSelectedSourceIds) {
                current.searchSelectedSourceIds - sourceId
            } else {
                current.searchSelectedSourceIds + sourceId
            }
            current.copy(searchSelectedSourceIds = next)
        }
        val query = _uiState.value.searchQuery
        if (query.isNotBlank()) onSearchQueryChange(query)
    }

    fun clearSearchHistory() {
        onUserInteraction()
        viewModelScope.launch {
            val wsId = _uiState.value.activeWorkspaceId
            repository.clearSearchHistory(wsId)
            _uiState.update { it.copy(searchHistory = emptyList()) }
        }
    }

    fun toggleBookmark(articleId: String) {
        onUserInteraction()
        val state = _uiState.value
        val wsId = state.activeWorkspaceId
        val target = state.articles.firstOrNull { it.id == articleId }
            ?: state.bookmarkedArticles.firstOrNull { it.id == articleId }
            ?: state.searchResults.firstOrNull { it.id == articleId }
            ?: return
        val nextValue = !target.isBookmarked
        viewModelScope.launch {
            repository.setBookmark(wsId, articleId, nextValue)
            val bookmarks = repository.getBookmarkedArticles(wsId)
            _uiState.update { cur ->
                cur.copy(
                    articles = cur.articles.map { if (it.id == articleId) it.copy(isBookmarked = nextValue) else it },
                    searchResults = cur.searchResults.map { if (it.id == articleId) it.copy(isBookmarked = nextValue) else it },
                    bookmarkedArticles = bookmarks,
                    selectedArticle = cur.selectedArticle?.let {
                        if (it.id == articleId) it.copy(isBookmarked = nextValue) else it
                    },
                )
            }
        }
    }

    fun openArticlePreview(article: Article) {
        onUserInteraction()
        _uiState.update { it.copy(selectedArticle = article) }
        val wsId = _uiState.value.activeWorkspaceId
        viewModelScope.launch {
            val hist = repository.recordReadingHistory(wsId, article)
            _uiState.update { it.copy(readingHistory = hist) }
        }
    }

    fun closeArticlePreview() {
        _uiState.update { it.copy(selectedArticle = null) }
    }

    fun clearReadingHistory() {
        onUserInteraction()
        val wsId = _uiState.value.activeWorkspaceId
        viewModelScope.launch {
            repository.clearReadingHistory(wsId)
            _uiState.update { it.copy(readingHistory = emptyList()) }
        }
    }

    fun saveCurrentFeedView(name: String) {
        onUserInteraction()
        val state = _uiState.value
        if (name.isBlank()) return
        viewModelScope.launch {
            val configs = repository.saveFeedConfig(
                workspaceId = state.activeWorkspaceId,
                name = name,
                categoryIds = if (state.selectedCategoryId == DefaultSeedData.ALL_NEWS_CATEGORY_ID) {
                    emptyList()
                } else listOf(state.selectedCategoryId),
                sourceIds = state.sources.filter { it.enabled }.map { it.id },
                sortOrder = state.preferences.sortOrder,
            )
            _uiState.update { it.copy(savedFeedConfigs = configs) }
        }
    }

    fun applySavedFeedView(config: SavedFeedConfig) {
        onUserInteraction()
        val cat = config.categoryIds.firstOrNull() ?: DefaultSeedData.ALL_NEWS_CATEGORY_ID
        val state = _uiState.value
        val nextPrefs = state.preferences.copy(sortOrder = config.sortOrder)
        _uiState.update { it.copy(selectedCategoryId = cat, preferences = nextPrefs) }
        viewModelScope.launch {
            repository.updatePreferences(state.activeWorkspaceId) { it.copy(sortOrder = config.sortOrder) }
            loadFeedPage(state.activeWorkspaceId, cat, nextPrefs, append = false)
        }
    }

    fun setCategoryManagerVisible(open: Boolean) {
        _uiState.update { it.copy(showCategoryManager = open) }
    }

    fun createCategory(name: String) {
        onUserInteraction()
        val wsId = _uiState.value.activeWorkspaceId
        viewModelScope.launch {
            val cats = repository.createCategory(wsId, name)
            _uiState.update { it.copy(categories = cats) }
        }
    }

    fun renameCategory(id: String, name: String) {
        onUserInteraction()
        val wsId = _uiState.value.activeWorkspaceId
        viewModelScope.launch {
            val cats = repository.updateCategory(wsId, id, name = name)
            _uiState.update { it.copy(categories = cats) }
        }
    }

    fun toggleCategory(id: String, enabled: Boolean) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            val cats = repository.updateCategory(state.activeWorkspaceId, id, enabled = enabled)
            _uiState.update { it.copy(categories = cats) }
            loadFeedPage(state.activeWorkspaceId, state.selectedCategoryId, state.preferences, append = false)
        }
    }

    fun deleteCategory(id: String) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            val cats = repository.deleteCategory(state.activeWorkspaceId, id)
            val nextSelected = if (state.selectedCategoryId == id) {
                DefaultSeedData.ALL_NEWS_CATEGORY_ID
            } else state.selectedCategoryId
            _uiState.update { it.copy(categories = cats, selectedCategoryId = nextSelected) }
            loadFeedPage(state.activeWorkspaceId, nextSelected, state.preferences, append = false)
        }
    }

    fun moveCategoryOrder(categoryId: String, direction: Int) {
        onUserInteraction()
        val state = _uiState.value
        val current = state.categories.toMutableList()
        val idx = current.indexOfFirst { it.id == categoryId }
        val target = idx + direction
        if (idx == -1 || target !in current.indices) return
        val item = current.removeAt(idx)
        current.add(target, item)
        viewModelScope.launch {
            val cats = repository.reorderCategories(state.activeWorkspaceId, current.map { it.id })
            _uiState.update { it.copy(categories = cats) }
        }
    }

    fun validateAndPreviewSource(url: String, categoryId: String) {
        onUserInteraction()
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    sourceActionBusy = true,
                    sourceActionError = null,
                    sourceActionMessage = null,
                    sourcePreview = null,
                )
            }
            try {
                val preview = repository.validateAndPreviewFeed(url, categoryId)
                _uiState.update {
                    it.copy(
                        sourceActionBusy = false,
                        sourcePreview = preview,
                        sourceActionMessage = "Validated ${preview.detectedFormat.value} feed with ${preview.sampleArticles.size} preview items.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update {
                    it.copy(
                        sourceActionBusy = false,
                        sourceActionError = ex.message ?: "Unable to validate feed URL.",
                    )
                }
            }
        }
    }

    fun addSource(
        name: String,
        url: String,
        format: FeedFormat,
        categoryId: String,
        description: String = "",
    ) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            try {
                val added = repository.addSource(
                    workspaceId = state.activeWorkspaceId,
                    name = name,
                    url = url,
                    format = format,
                    categoryId = categoryId,
                    description = description,
                )
                val all = repository.getSources(state.activeWorkspaceId)
                _uiState.update {
                    it.copy(
                        sources = all,
                        sourcePreview = null,
                        sourceActionError = null,
                        sourceActionMessage = "Subscribed to ${added.name}. Pull down or tap Refresh to fetch.",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update { it.copy(sourceActionError = ex.message) }
            }
        }
    }

    fun toggleSource(sourceId: String) {
        onUserInteraction()
        val state = _uiState.value
        val target = state.sources.firstOrNull { it.id == sourceId } ?: return
        viewModelScope.launch {
            val updated = repository.updateSource(state.activeWorkspaceId, sourceId, enabled = !target.enabled)
            _uiState.update { it.copy(sources = updated) }
            loadFeedPage(state.activeWorkspaceId, state.selectedCategoryId, state.preferences, append = false)
        }
    }

    fun updateSourceDetails(sourceId: String, name: String, categoryId: String) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            val updated = repository.updateSource(
                state.activeWorkspaceId,
                sourceId,
                name = name,
                categoryId = categoryId,
            )
            _uiState.update {
                it.copy(sources = updated, sourceActionMessage = "Source updated.")
            }
        }
    }

    fun testSource(sourceId: String) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            _uiState.update { it.copy(sourceActionBusy = true, sourceActionError = null, sourceActionMessage = null) }
            val result = repository.testSource(state.activeWorkspaceId, sourceId)
            val sources = repository.getSources(state.activeWorkspaceId)
            loadFeedPage(state.activeWorkspaceId, state.selectedCategoryId, state.preferences, append = false)
            _uiState.update {
                it.copy(
                    sourceActionBusy = false,
                    sources = sources,
                    sourceActionMessage = if (result.status != "error") {
                        "${result.sourceName}: ${result.status} (+${result.insertedCount} new)"
                    } else null,
                    sourceActionError = result.errorMessage,
                )
            }
        }
    }

    fun deleteSource(sourceId: String) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            val updated = repository.deleteSource(state.activeWorkspaceId, sourceId)
            _uiState.update { it.copy(sources = updated) }
            loadFeedPage(state.activeWorkspaceId, state.selectedCategoryId, state.preferences, append = false)
        }
    }

    fun importOpml(xmlText: String) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            try {
                val (count, skipped) = repository.importOpml(state.activeWorkspaceId, xmlText)
                val sources = repository.getSources(state.activeWorkspaceId)
                _uiState.update {
                    it.copy(
                        sources = sources,
                        sourceActionError = null,
                        sourceActionMessage = "Imported $count feed(s)" +
                            if (skipped.isNotEmpty()) " (${skipped.size} skipped)." else ".",
                    )
                }
            } catch (ex: Exception) {
                _uiState.update { it.copy(sourceActionError = ex.message ?: "OPML import failed.") }
            }
        }
    }

    suspend fun buildOpmlExport(): String =
        repository.exportOpml(_uiState.value.activeWorkspaceId)

    fun updatePreferences(transform: (AppPreferences) -> AppPreferences) {
        onUserInteraction()
        val state = _uiState.value
        viewModelScope.launch {
            val updated = repository.updatePreferences(state.activeWorkspaceId, transform)
            _uiState.update { it.copy(preferences = updated) }
            if (state.activeWorkspaceId == DefaultSeedData.DEFAULT_WORKSPACE_ID) {
                FeedSyncWorker.scheduleFromPreferences(appContext, updated)
            }
            if (updated.articlesPerPage != state.preferences.articlesPerPage ||
                updated.sortOrder != state.preferences.sortOrder
            ) {
                loadFeedPage(state.activeWorkspaceId, state.selectedCategoryId, updated, append = false)
            }
        }
    }

    fun clearSourceMessages() {
        _uiState.update { it.copy(sourceActionError = null, sourceActionMessage = null) }
    }

    private fun startAuthCooldown(ex: Exception) {
        val secs = (ex as? com.aleisteralvear.newsie.security.workspaces.WorkspaceAuthException)
            ?.retryAfterSeconds ?: 0
        if (secs <= 0) return
        cooldownJob?.cancel()
        _uiState.update { it.copy(authCooldownSeconds = secs) }
        cooldownJob = viewModelScope.launch {
            var remaining = secs
            while (remaining > 0) {
                delay(1000L)
                remaining--
                _uiState.update { it.copy(authCooldownSeconds = remaining) }
            }
        }
    }

    class Factory(private val app: com.aleisteralvear.newsie.NewsieApplication) :
        ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return NewsieViewModel(
                appContext = app,
                repository = app.container.repository,
                vaultManager = app.container.vaultManager,
                keystoreProvider = app.container.keystoreManager,
            ) as T
        }
    }
}
