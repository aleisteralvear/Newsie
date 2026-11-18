package com.aleisteralvear.newsie

import android.content.Context
import com.aleisteralvear.newsie.data.database.NewsieDatabase
import com.aleisteralvear.newsie.data.preferences.NewsiePreferencesStore
import com.aleisteralvear.newsie.data.repository.NewsieRepository
import com.aleisteralvear.newsie.network.http.NewsHttpClient
import com.aleisteralvear.newsie.security.keystore.AndroidKeystoreManager
import com.aleisteralvear.newsie.security.workspaces.WorkspaceVaultManager

class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val keystoreManager: AndroidKeystoreManager by lazy { AndroidKeystoreManager(appContext) }
    val database: NewsieDatabase by lazy {
        NewsieDatabase.createEncrypted(appContext, keystoreManager)
    }
    val preferencesStore = NewsiePreferencesStore(appContext)
    val httpClient = NewsHttpClient()
    val vaultManager: WorkspaceVaultManager by lazy {
        WorkspaceVaultManager(
            db = database,
            keystoreProvider = keystoreManager,
        )
    }
    val repository: NewsieRepository by lazy {
        NewsieRepository(
            db = database,
            publicPreferences = preferencesStore,
            vault = vaultManager,
            httpClient = httpClient,
        )
    }
}
