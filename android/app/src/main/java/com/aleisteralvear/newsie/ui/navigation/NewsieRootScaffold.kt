package com.aleisteralvear.newsie.ui.navigation

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.aleisteralvear.newsie.domain.models.NavTab
import com.aleisteralvear.newsie.domain.models.WorkspaceAuthMethod
import com.aleisteralvear.newsie.domain.models.WorkspaceSummary
import com.aleisteralvear.newsie.security.biometric.BiometricPromptResult
import com.aleisteralvear.newsie.security.biometric.NativeBiometricAuthManager
import com.aleisteralvear.newsie.ui.NewsieUiState
import com.aleisteralvear.newsie.ui.NewsieViewModel
import com.aleisteralvear.newsie.ui.components.ArticlePreviewSheet
import com.aleisteralvear.newsie.ui.components.CategoryManagerDialog
import com.aleisteralvear.newsie.ui.home.HomeScreen
import com.aleisteralvear.newsie.ui.saved.SavedScreen
import com.aleisteralvear.newsie.ui.search.SearchScreen
import com.aleisteralvear.newsie.ui.settings.SettingsScreen
import com.aleisteralvear.newsie.ui.sources.SourcesScreen
import com.aleisteralvear.newsie.ui.workspace.CreateWorkspaceDialog
import com.aleisteralvear.newsie.ui.workspace.PrivateAuthGateDialog
import com.aleisteralvear.newsie.ui.workspace.PrivateDashboardScreen
import com.aleisteralvear.newsie.ui.workspace.UnlockWorkspaceDialog
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewsieRootScaffold(
    uiState: NewsieUiState,
    viewModel: NewsieViewModel,
    activity: FragmentActivity,
    isTabletLayout: Boolean,
) {
    val scope = rememberCoroutineScope()
    var lastSearchNavTapMs by remember { mutableLongStateOf(0L) }

    val handleTabSelection: (NavTab) -> Unit = { tab ->
        if (tab == NavTab.SEARCH) {
            val now = SystemClock.elapsedRealtime()
            val windowMs = uiState.privateAccessStatus.doubleTapIntervalMs.toLong()
            if (lastSearchNavTapMs > 0L && (now - lastSearchNavTapMs) <= windowMs) {
                lastSearchNavTapMs = 0L
                viewModel.requestPrivateAccessEntry()
            } else {
                lastSearchNavTapMs = now
                viewModel.selectNavTab(tab)
            }
        } else {
            lastSearchNavTapMs = 0L
            viewModel.selectNavTab(tab)
        }
    }

    // Back gesture safety: close modals -> exit PrivateDashboard -> return Home
    BackHandler(
        enabled = uiState.selectedArticle != null ||
            uiState.showPrivateDashboard ||
            uiState.activeTab != NavTab.HOME,
    ) {
        when {
            uiState.selectedArticle != null -> viewModel.closeArticlePreview()
            uiState.showPrivateDashboard -> viewModel.switchToPublicWorkspace()
            uiState.activeTab != NavTab.HOME -> viewModel.selectNavTab(NavTab.HOME)
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets.safeDrawing,
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                        titleContentColor = MaterialTheme.colorScheme.onBackground,
                    ),
                    title = {
                        Text(
                            text = "Newsie",
                            style = MaterialTheme.typography.headlineMedium,
                        )
                    },
                    actions = {
                        // Only visible inside an actively authenticated private session
                        if (uiState.activeWorkspaceIsPrivate && !uiState.activeWorkspaceLocked) {
                            IconButton(onClick = { viewModel.requestPrivateAccessEntry() }) {
                                Icon(
                                    imageVector = Icons.Outlined.Shield,
                                    contentDescription = "Open Private Workspace Dashboard",
                                    tint = MaterialTheme.colorScheme.tertiary,
                                )
                            }
                            IconButton(
                                onClick = { viewModel.lockSpecificWorkspace(uiState.activeWorkspaceId) },
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Lock,
                                    contentDescription = "Lock Private Workspace",
                                    tint = MaterialTheme.colorScheme.tertiary,
                                )
                            }
                        }
                        if (!uiState.showPrivateDashboard) {
                            IconButton(
                                enabled = !uiState.refreshState.isRefreshing,
                                onClick = { viewModel.refreshFeeds() },
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Refresh,
                                    contentDescription = "Refresh news feeds",
                                )
                            }
                        }
                    },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        },
        bottomBar = {
            if (!isTabletLayout && !uiState.showPrivateDashboard) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.background,
                ) {
                    NavTab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = uiState.activeTab == tab,
                            onClick = { handleTabSelection(tab) },
                            icon = { Icon(tabIcon(tab), contentDescription = tab.label) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            if (isTabletLayout && !uiState.showPrivateDashboard) {
                NavigationRail(
                    containerColor = MaterialTheme.colorScheme.background,
                ) {
                    NavTab.entries.forEach { tab ->
                        NavigationRailItem(
                            selected = uiState.activeTab == tab,
                            onClick = { handleTabSelection(tab) },
                            icon = { Icon(tabIcon(tab), contentDescription = tab.label) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }

            Box(modifier = Modifier.weight(1f).fillMaxSize()) {
                when {
                    uiState.showPrivateDashboard -> {
                        PrivateDashboardScreen(
                            workspaces = uiState.dashboardWorkspaces,
                            activeWorkspaceId = uiState.activeWorkspaceId,
                            accessStatus = uiState.privateAccessStatus,
                            biometricCapability = uiState.biometricCapability,
                            noticeMessage = uiState.dashboardNotice,
                            errorMessage = uiState.authError,
                            onBackToReader = { viewModel.switchToPublicWorkspace() },
                            onLockAllAndExit = { viewModel.lockAllAndReturnPublic() },
                            onCreateNewWorkspace = { viewModel.setCreateWorkspaceModalOpen(true) },
                            onOpenOrUnlockWorkspace = { viewModel.openWorkspaceFromDashboard(it) },
                            onLockWorkspace = { viewModel.lockSpecificWorkspace(it) },
                            onRenameWorkspace = { id, name -> viewModel.renameWorkspace(id, name) },
                            onUpdateAutoLock = { id, mins -> viewModel.updateWorkspaceAutoLock(id, mins) },
                            onEnrollBiometric = { ws, method ->
                                scope.launch {
                                    runCatching {
                                        val (cipher, _) = viewModel.keystoreProvider.ensureBiometricKeyAndEncryptCipher(ws.id)
                                        when (
                                            val outcome = NativeBiometricAuthManager.authenticateWithCrypto(
                                                activity = activity,
                                                cipher = cipher,
                                                title = "Bind Biometric Key",
                                                subtitle = "Confirm strong biometric for ${ws.displayName}",
                                            )
                                        ) {
                                            is BiometricPromptResult.Authenticated -> {
                                                viewModel.enrollBiometricWithCipher(ws.id, outcome.cipher, method)
                                            }
                                            is BiometricPromptResult.Error -> {
                                                viewModel.keystoreProvider.deleteBiometricKey(ws.id)
                                                viewModel.reportAuthError(outcome.message)
                                            }
                                            BiometricPromptResult.Cancelled -> {
                                                viewModel.keystoreProvider.deleteBiometricKey(ws.id)
                                            }
                                        }
                                    }.onFailure { ex ->
                                        viewModel.keystoreProvider.deleteBiometricKey(ws.id)
                                        viewModel.reportAuthError(ex.message ?: "Unable to bind biometric key.")
                                    }
                                }
                            },
                            onRotatePassphrase = { id, oldP, newP ->
                                viewModel.rotateWorkspacePassphrase(id, oldP, newP)
                            },
                            onDeleteWorkspace = { ws, pass ->
                                if (ws.authMethod == WorkspaceAuthMethod.BOTH) {
                                    scope.launch {
                                        runCatching {
                                            val cipher = viewModel.vaultManager.prepareBiometricDecryptCipher(ws.id)
                                            val outcome = NativeBiometricAuthManager.authenticateWithCrypto(
                                                activity = activity,
                                                cipher = cipher,
                                                title = "Confirm Workspace Deletion",
                                                subtitle = "Biometric confirmation required for ${ws.displayName}",
                                            )
                                            when (outcome) {
                                                is BiometricPromptResult.Authenticated -> viewModel.deleteWorkspace(ws.id, pass, outcome.cipher)
                                                is BiometricPromptResult.Error -> viewModel.reportAuthError(outcome.message)
                                                BiometricPromptResult.Cancelled -> Unit
                                            }
                                        }.onFailure { ex ->
                                            viewModel.reportAuthError(ex.message ?: "Biometric confirmation failed.")
                                        }
                                    }
                                } else {
                                    viewModel.deleteWorkspace(ws.id, pass, null)
                                }
                            },
                            onSaveSearchPhrase = { viewModel.updateMethodASearchPhrase(it) },
                            onSaveDoubleTapMs = { viewModel.updateDoubleTapInterval(it) },
                        )
                    }

                    uiState.activeTab == NavTab.HOME -> HomeScreen(
                        articles = uiState.articles,
                        totalArticles = uiState.totalArticles,
                        hasMore = uiState.hasMoreArticles,
                        isLoadingMore = uiState.isLoadingMore,
                        loadError = uiState.loadError,
                        categories = uiState.categories,
                        selectedCategoryId = uiState.selectedCategoryId,
                        sortOrder = uiState.preferences.sortOrder,
                        savedConfigs = uiState.savedFeedConfigs,
                        layoutDensity = uiState.preferences.layoutDensity,
                        showImages = uiState.preferences.showImages,
                        textSize = uiState.preferences.textSize,
                        refreshState = uiState.refreshState,
                        isTabletLayout = isTabletLayout,
                        onSelectCategory = { viewModel.selectCategory(it) },
                        onChangeSortOrder = { viewModel.changeSortOrder(it) },
                        onApplySavedConfig = { viewModel.applySavedFeedView(it) },
                        onSaveFeedConfig = { viewModel.saveCurrentFeedView(it) },
                        onOpenCategoryManager = { viewModel.setCategoryManagerVisible(true) },
                        onRefresh = { viewModel.refreshFeeds() },
                        onLoadMore = { viewModel.loadMoreArticles() },
                        onToggleBookmark = { viewModel.toggleBookmark(it) },
                        onOpenArticle = { viewModel.openArticlePreview(it) },
                        onGoToSources = { viewModel.selectNavTab(NavTab.SOURCES) },
                    )

                    uiState.activeTab == NavTab.SEARCH -> SearchScreen(
                        query = uiState.searchQuery,
                        scope = uiState.searchScope,
                        sources = uiState.sources,
                        selectedSourceIds = uiState.searchSelectedSourceIds,
                        results = uiState.searchResults,
                        searchHistory = uiState.searchHistory,
                        searchHistoryEnabled = uiState.preferences.searchHistoryEnabled,
                        showImages = uiState.preferences.showImages,
                        textSize = uiState.preferences.textSize,
                        onQueryChange = { viewModel.onSearchQueryChange(it) },
                        onScopeChange = { viewModel.updateSearchScope(it) },
                        onToggleSelectedSource = { viewModel.toggleSearchSelectedSource(it) },
                        onSubmitSearch = { viewModel.submitSearch(it) },
                        onClearHistory = { viewModel.clearSearchHistory() },
                        onToggleBookmark = { viewModel.toggleBookmark(it) },
                        onOpenArticle = { viewModel.openArticlePreview(it) },
                    )

                    uiState.activeTab == NavTab.SAVED -> SavedScreen(
                        bookmarkedArticles = uiState.bookmarkedArticles,
                        readingHistory = uiState.readingHistory,
                        readingHistoryEnabled = uiState.preferences.readingHistoryEnabled,
                        showImages = uiState.preferences.showImages,
                        textSize = uiState.preferences.textSize,
                        onToggleBookmark = { viewModel.toggleBookmark(it) },
                        onOpenArticle = { viewModel.openArticlePreview(it) },
                        onClearReadingHistory = { viewModel.clearReadingHistory() },
                        onGoToHome = { viewModel.selectNavTab(NavTab.HOME) },
                    )

                    uiState.activeTab == NavTab.SOURCES -> SourcesScreen(
                        sources = uiState.sources,
                        directory = uiState.directory,
                        categories = uiState.categories,
                        sourcePreview = uiState.sourcePreview,
                        busy = uiState.sourceActionBusy,
                        statusMessage = uiState.sourceActionMessage,
                        errorMessage = uiState.sourceActionError,
                        onToggleSource = { viewModel.toggleSource(it) },
                        onUpdateSource = { id, n, c -> viewModel.updateSourceDetails(id, n, c) },
                        onDeleteSource = { viewModel.deleteSource(it) },
                        onTestSource = { viewModel.testSource(it) },
                        onValidatePreview = { u, c -> viewModel.validateAndPreviewSource(u, c) },
                        onAddSource = { n, u, f, c, d -> viewModel.addSource(n, u, f, c, d) },
                        onImportOpml = { viewModel.importOpml(it) },
                        onBuildOpmlExport = { viewModel.buildOpmlExport() },
                    )

                    uiState.activeTab == NavTab.SETTINGS -> SettingsScreen(
                        preferences = uiState.preferences,
                        onUpdatePreferences = { viewModel.updatePreferences(it) },
                        onClearSearchHistory = { viewModel.clearSearchHistory() },
                    )
                }
            }
        }
    }

    uiState.selectedArticle?.let { article ->
        ArticlePreviewSheet(
            article = article,
            showImages = uiState.preferences.showImages,
            onDismiss = { viewModel.closeArticlePreview() },
            onToggleBookmark = { viewModel.toggleBookmark(it) },
        )
    }

    if (uiState.showCategoryManager) {
        CategoryManagerDialog(
            categories = uiState.categories,
            onDismiss = { viewModel.setCategoryManagerVisible(false) },
            onCreateCategory = { viewModel.createCategory(it) },
            onToggleCategory = { id, en -> viewModel.toggleCategory(id, en) },
            onRenameCategory = { id, n -> viewModel.renameCategory(id, n) },
            onDeleteCategory = { viewModel.deleteCategory(it) },
            onMoveCategory = { id, dir -> viewModel.moveCategoryOrder(id, dir) },
        )
    }

    if (uiState.showPrivateAuthModal) {
        PrivateAuthGateDialog(
            accessStatus = uiState.privateAccessStatus,
            biometricCapability = uiState.biometricCapability,
            busy = uiState.authBusy,
            errorMessage = uiState.authError,
            cooldownSeconds = uiState.authCooldownSeconds,
            onDismiss = { viewModel.dismissPrivateAuthModal() },
            onFirstTimeCreate = { n, p, m -> viewModel.createFirstWorkspaceFromGate(n, p, m) },
            onAuthenticatePassphrase = { viewModel.authenticatePrivateGateWithPassphrase(it) },
            onAuthenticateBiometric = {
                scope.launch {
                    val targetId = viewModel.findFirstBiometricWorkspaceForGate() ?: return@launch
                    runCatching {
                        val cipher = viewModel.vaultManager.prepareBiometricDecryptCipher(targetId)
                        val outcome = NativeBiometricAuthManager.authenticateWithCrypto(
                            activity = activity,
                            cipher = cipher,
                            title = "Private Access Verification",
                            subtitle = "Verify strong biometrics to enter dashboard",
                        )
                        when (outcome) {
                            is BiometricPromptResult.Authenticated -> viewModel.completeBiometricDashboardGate(targetId, outcome.cipher)
                            is BiometricPromptResult.Error -> viewModel.reportAuthError(outcome.message)
                            BiometricPromptResult.Cancelled -> Unit
                        }
                    }.onFailure { ex ->
                        viewModel.reportAuthError(ex.message ?: "Biometric gate check failed.")
                    }
                }
            },
        )
    }

    uiState.showUnlockTargetModal?.let { ws ->
        UnlockWorkspaceDialog(
            workspace = ws,
            biometricCapability = uiState.biometricCapability,
            busy = uiState.authBusy,
            errorMessage = uiState.authError,
            cooldownSeconds = uiState.authCooldownSeconds,
            onDismiss = { viewModel.dismissUnlockModal() },
            onUnlockPassphrase = { id, pass, rec -> viewModel.unlockTargetWithPassphrase(id, pass, rec) },
            onUnlockBiometric = { id ->
                scope.launch {
                    runCatching {
                        val cipher = viewModel.vaultManager.prepareBiometricDecryptCipher(id)
                        val outcome = NativeBiometricAuthManager.authenticateWithCrypto(
                            activity = activity,
                            cipher = cipher,
                            title = "Unlock ${ws.displayName}",
                            subtitle = "Confirm strong biometric credential",
                        )
                        when (outcome) {
                            is BiometricPromptResult.Authenticated -> viewModel.unlockTargetWithBiometricCipher(id, outcome.cipher)
                            is BiometricPromptResult.Error -> viewModel.reportAuthError(outcome.message)
                            BiometricPromptResult.Cancelled -> Unit
                        }
                    }.onFailure { ex ->
                        viewModel.reportAuthError(ex.message ?: "Biometric unlock failed.")
                    }
                }
            },
            onUnlockBothFactors = { id, pass ->
                scope.launch {
                    runCatching {
                        val cipher = viewModel.vaultManager.prepareBiometricDecryptCipher(id)
                        val outcome = NativeBiometricAuthManager.authenticateWithCrypto(
                            activity = activity,
                            cipher = cipher,
                            title = "Multi-Factor Verification",
                            subtitle = "Confirm biometric second factor for ${ws.displayName}",
                        )
                        when (outcome) {
                            is BiometricPromptResult.Authenticated -> viewModel.unlockTargetWithBothFactors(id, pass, outcome.cipher)
                            is BiometricPromptResult.Error -> viewModel.reportAuthError(outcome.message)
                            BiometricPromptResult.Cancelled -> Unit
                        }
                    }.onFailure { ex ->
                        viewModel.reportAuthError(ex.message ?: "Biometric verification failed.")
                    }
                }
            },
        )
    }

    if (uiState.showCreateWorkspaceModal) {
        CreateWorkspaceDialog(
            busy = uiState.authBusy,
            errorMessage = uiState.authError,
            onDismiss = { viewModel.setCreateWorkspaceModalOpen(false) },
            onCreate = { n, p, m -> viewModel.createWorkspaceFromDashboard(n, p, m) },
        )
    }

    if (uiState.isPrivacyScreenBlurred && uiState.requiresFlagSecure) {
        AlertDialog(
            onDismissRequest = {},
            icon = { Icon(Icons.Outlined.Lock, contentDescription = null) },
            title = { Text("Private Session Shielded") },
            text = {
                Text(
                    "Sensitive workspace views are concealed after switching away from Newsie.",
                    style = MaterialTheme.typography.bodySmall,
                )
            },
            confirmButton = {
                Button(onClick = { viewModel.dismissPrivacyBlur() }) {
                    Text("Resume")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { viewModel.lockAllAndReturnPublic() }) {
                    Text("Lock & Exit")
                }
            },
        )
    }
}

private fun tabIcon(tab: NavTab): ImageVector = when (tab) {
    NavTab.HOME -> Icons.Outlined.Home
    NavTab.SEARCH -> Icons.Outlined.Search
    NavTab.SAVED -> Icons.Outlined.BookmarkBorder
    NavTab.SOURCES -> Icons.Outlined.Explore
    NavTab.SETTINGS -> Icons.Outlined.Settings
}
