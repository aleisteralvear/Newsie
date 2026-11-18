package com.aleisteralvear.newsie.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.aleisteralvear.newsie.domain.models.AppTheme

object NewsieColors {
    val DeepNavy = Color(0xFF0B192C)
    val NavyCard = Color(0xFF10233D)
    val NavyElevated = Color(0xFF172E4D)
    val NavyBorder = Color(0xFF1E324D)
    val NavyBorderStrong = Color(0xFF294366)

    val WarmPaper = Color(0xFFFBF9F5)
    val WarmPaperMuted = Color(0xFFF3EFE6)
    val PureWhite = Color(0xFFFFFFFF)
    val LightBorder = Color(0xFFE3DDD1)
    val LightBorderStrong = Color(0xFFD8D0C0)

    val AntiqueGold = Color(0xFFB0893E)
    val AntiqueGoldDarkInk = Color(0xFF8E6A28)
    val AntiqueGoldLight = Color(0xFFD4AF6A)

    val MutedGray = Color(0xFF5C6470)
    val DarkMutedText = Color(0xFF9AA6B8)
    val InkBodyLight = Color(0xFF3C4655)
    val InkBodyDark = Color(0xFFDCE3ED)

    val ErrorRedLight = Color(0xFF991B1B)
    val ErrorRedContainerLight = Color(0xFFFEF2F2)
    val ErrorRedDark = Color(0xFFFCA5A5)
    val ErrorRedContainerDark = Color(0xFF450A0A)
}

private val LightColors = lightColorScheme(
    primary = NewsieColors.DeepNavy,
    onPrimary = NewsieColors.WarmPaper,
    primaryContainer = NewsieColors.WarmPaperMuted,
    onPrimaryContainer = NewsieColors.DeepNavy,
    secondary = NewsieColors.AntiqueGold,
    onSecondary = NewsieColors.DeepNavy,
    secondaryContainer = NewsieColors.WarmPaperMuted,
    onSecondaryContainer = NewsieColors.AntiqueGoldDarkInk,
    tertiary = NewsieColors.AntiqueGoldDarkInk,
    background = NewsieColors.WarmPaper,
    onBackground = NewsieColors.DeepNavy,
    surface = NewsieColors.PureWhite,
    onSurface = NewsieColors.DeepNavy,
    surfaceVariant = NewsieColors.WarmPaperMuted,
    onSurfaceVariant = NewsieColors.MutedGray,
    outline = NewsieColors.LightBorderStrong,
    outlineVariant = NewsieColors.LightBorder,
    error = NewsieColors.ErrorRedLight,
    errorContainer = NewsieColors.ErrorRedContainerLight,
)

private val DarkColors = darkColorScheme(
    primary = NewsieColors.AntiqueGoldLight,
    onPrimary = NewsieColors.DeepNavy,
    primaryContainer = NewsieColors.NavyElevated,
    onPrimaryContainer = NewsieColors.WarmPaper,
    secondary = NewsieColors.AntiqueGold,
    onSecondary = NewsieColors.DeepNavy,
    secondaryContainer = NewsieColors.NavyCard,
    onSecondaryContainer = NewsieColors.AntiqueGoldLight,
    tertiary = NewsieColors.AntiqueGoldLight,
    background = NewsieColors.DeepNavy,
    onBackground = NewsieColors.WarmPaper,
    surface = NewsieColors.NavyCard,
    onSurface = NewsieColors.WarmPaper,
    surfaceVariant = NewsieColors.NavyElevated,
    onSurfaceVariant = NewsieColors.DarkMutedText,
    outline = NewsieColors.NavyBorderStrong,
    outlineVariant = NewsieColors.NavyBorder,
    error = NewsieColors.ErrorRedDark,
    errorContainer = NewsieColors.ErrorRedContainerDark,
)

private val NewsieTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 30.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.4).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.2).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 19.sp,
        lineHeight = 25.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp,
        lineHeight = 23.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 23.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
    ),
)

@Composable
fun NewsieTheme(
    appTheme: AppTheme,
    content: @Composable () -> Unit,
) {
    val isDark = when (appTheme) {
        AppTheme.LIGHT -> false
        AppTheme.DARK -> true
        AppTheme.SYSTEM -> isSystemInDarkTheme()
    }
    MaterialTheme(
        colorScheme = if (isDark) DarkColors else LightColors,
        typography = NewsieTypography,
        content = content,
    )
}
