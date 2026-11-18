package com.aleisteralvear.newsie

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aleisteralvear.newsie.ui.NewsieViewModel
import com.aleisteralvear.newsie.ui.navigation.NewsieRootScaffold
import com.aleisteralvear.newsie.ui.theme.NewsieTheme

class MainActivity : FragmentActivity() {

    private val viewModel: NewsieViewModel by viewModels {
        NewsieViewModel.Factory(application as NewsieApplication)
    }

    private var screenOffReceiver: BroadcastReceiver? = null

    private val processLifecycleObserver = object : DefaultLifecycleObserver {
        override fun onStop(owner: LifecycleOwner) {
            viewModel.onAppBackgrounded()
        }

        override fun onStart(owner: LifecycleOwner) {
            viewModel.onAppForegrounded()
        }
    }

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        ProcessLifecycleOwner.get().lifecycle.addObserver(processLifecycleObserver)
        registerScreenLockReceiver()

        setContent {
            val uiState by viewModel.uiState.collectAsStateWithLifecycle()
            val windowSize = calculateWindowSizeClass(this)
            val isTablet = windowSize.widthSizeClass >= WindowWidthSizeClass.Medium

            // Enforce FLAG_SECURE whenever displaying private workspace content or auth/dashboard dialogs
            LaunchedEffect(uiState.requiresFlagSecure) {
                if (uiState.requiresFlagSecure) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                }
            }

            NewsieTheme(appTheme = uiState.preferences.theme) {
                NewsieRootScaffold(
                    uiState = uiState,
                    viewModel = viewModel,
                    activity = this,
                    isTabletLayout = isTablet,
                )
            }
        }
    }

    override fun onDestroy() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(processLifecycleObserver)
        screenOffReceiver?.let { runCatching { unregisterReceiver(it) } }
        super.onDestroy()
    }

    private fun registerScreenLockReceiver() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == Intent.ACTION_SCREEN_OFF) {
                    viewModel.onScreenLocked()
                }
            }
        }
        screenOffReceiver = receiver
        registerReceiver(receiver, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }
}
