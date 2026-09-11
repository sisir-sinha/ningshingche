package com.ningshingche.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BrightnessAuto
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.ViewModule
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.ui.navigation.ExploreTab
import com.ningshingche.app.ui.navigation.Screen
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalDarkBg
import com.ningshingche.app.ui.theme.PortalMaroon
import com.ningshingche.app.ui.theme.PortalSaffron

/**
 * Navigation drawer for the portal.
 *
 * Flat by design — no collapsible groups. Items are grouped only by thin
 * dividers:
 *
 * 1. Home, Featured, Explore, PDF archive, Search, Saved
 * 2. Annual issues, Categories  (both open Explore on the matching tab)
 * 3. About, Authors, Social activities
 * 4. Settings, Share the app
 *
 * The header carries the brand and a theme button that cycles
 * System → Light → Dark. The default mode is *System*, which is why the
 * button exposes all three states instead of a plain light/dark switch.
 */

/**
 * The sheet's width.
 *
 * Exposed because the navigation host draws an empty placeholder of the same size
 * while the splash is on screen: Material3 measures this sheet to learn where
 * "closed" sits, and a placeholder of a different width would move that anchor.
 */
val PortalDrawerWidth = 304.dp

@Composable
fun PortalDrawerContent(
    currentRoute: String,
    isDark: Boolean,
    themeMode: AppThemeMode,
    onNavigate: (String) -> Unit,
    onExploreTab: (ExploreTab) -> Unit,
    onCycleTheme: () -> Unit,
    onShareApp: () -> Unit,
    onCloseDrawer: () -> Unit,
    isSignedIn: Boolean = false,
    dashboardUnreadCount: Int = 0
) {
    val exploreRoute = Screen.Explore.route
    val onExploreRoute = currentRoute.startsWith(exploreRoute)

    ModalDrawerSheet(
        drawerContainerColor = MaterialTheme.colorScheme.surface,
        drawerContentColor = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier
            .fillMaxHeight()
            .width(PortalDrawerWidth)
            .testTag("portal_drawer")
    ) {
        DrawerHeader(
            isDark = isDark,
            themeMode = themeMode,
            onCycleTheme = onCycleTheme,
            showDashboard = isSignedIn,
            dashboardSelected = currentRoute == Screen.UserDashboard.route,
            dashboardUnreadCount = dashboardUnreadCount,
            onOpenDashboard = { onCloseDrawer(); onNavigate(Screen.UserDashboard.route) }
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(vertical = 8.dp)
        ) {
            DrawerRow("ঘর", Icons.Default.Home, currentRoute == Screen.Home.route) {
                onCloseDrawer(); onNavigate(Screen.Home.route)
            }
            DrawerRow("ফিচার্ড", Icons.Default.Star, currentRoute == Screen.Featured.route) {
                onCloseDrawer(); onNavigate(Screen.Featured.route)
            }
            DrawerRow("অন্বেষণ", Icons.Default.Explore, onExploreRoute) {
                onCloseDrawer(); onNavigate(exploreRoute)
            }
            DrawerRow("PDF আর্কাইভ", Icons.Default.PictureAsPdf, currentRoute == Screen.PdfArchive.route) {
                onCloseDrawer(); onNavigate(Screen.PdfArchive.route)
            }
            DrawerRow("সঙ্গীত", Icons.Default.LibraryMusic, currentRoute == Screen.Music.route) {
                onCloseDrawer(); onNavigate(Screen.Music.route)
            }
            DrawerRow("অনুসন্ধান", Icons.Default.Search, currentRoute == Screen.Search.route) {
                onCloseDrawer(); onNavigate(Screen.Search.route)
            }
            DrawerRow("সংরক্ষিত", Icons.Default.Bookmark, currentRoute == Screen.Bookmarks.route) {
                onCloseDrawer(); onNavigate(Screen.Bookmarks.route)
            }

            DrawerDivider()

            DrawerRow("বার্ষিক সংখ্যা", Icons.Default.CalendarMonth, false) {
                onCloseDrawer(); onExploreTab(ExploreTab.Issues)
            }
            DrawerRow("বিভাগসমূহ", Icons.Default.ViewModule, false) {
                onCloseDrawer(); onExploreTab(ExploreTab.Categories)
            }

            DrawerDivider()

            DrawerRow("আমার সম্পর্কে", Icons.Default.Info, currentRoute == Screen.About.route) {
                onCloseDrawer(); onNavigate(Screen.About.route)
            }
            DrawerRow("লেখক", Icons.Default.People, currentRoute == Screen.AuthorsDirectory.route) {
                onCloseDrawer(); onNavigate(Screen.AuthorsDirectory.route)
            }
            DrawerRow("সামাজিক কার্যকলাপ", Icons.Default.Groups, currentRoute == Screen.SocialActivities.route) {
                onCloseDrawer(); onNavigate(Screen.SocialActivities.route)
            }

            DrawerDivider()

            DrawerRow("সেটিংস", Icons.Default.Settings, currentRoute == Screen.Settings.route) {
                onCloseDrawer(); onNavigate(Screen.Settings.route)
            }
            DrawerRow("অ্যাপ শেয়ার করুন", Icons.Default.Share, false) {
                onCloseDrawer(); onShareApp()
            }

            Spacer(Modifier.navigationBarsPadding().height(8.dp))
        }
    }
}

@Composable
private fun DrawerHeader(
    isDark: Boolean,
    themeMode: AppThemeMode,
    onCycleTheme: () -> Unit,
    showDashboard: Boolean = false,
    dashboardSelected: Boolean = false,
    dashboardUnreadCount: Int = 0,
    onOpenDashboard: () -> Unit = {}
) {
    val headerColor by animateColorAsState(
        targetValue = if (isDark) PortalDarkBg else PortalMaroon,
        animationSpec = tween(320),
        label = "drawer_header"
    )
    val (themeIcon, themeLabel) = when (themeMode) {
        AppThemeMode.SYSTEM -> Icons.Default.BrightnessAuto to "থিম: সিস্টেম (স্বয়ংক্রিয়)"
        AppThemeMode.LIGHT -> Icons.Default.LightMode to "থিম: লাইট"
        AppThemeMode.DARK -> Icons.Default.DarkMode to "থিম: ডার্ক"
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(headerColor)
            .statusBarsPadding()
            .padding(start = 18.dp, end = 8.dp, top = 18.dp, bottom = 18.dp)
            .testTag("drawer_header"),
        verticalAlignment = Alignment.CenterVertically
    ) {
        NingshingCheBrandLogo(size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "নিংশিং চে",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                fontSize = 20.sp,
                lineHeight = 24.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "বিষ্ণুপ্রিয়া মণিপুরি তথ্যকোষ",
                fontFamily = Kalpurush,
                color = PortalSaffron,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        // Signed-in readers get a shortcut to their dashboard, left of the theme button.
        if (showDashboard) {
            Surface(
                shape = CircleShape,
                color = if (dashboardSelected) PortalSaffron.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.14f)
            ) {
                Box {
                    IconButton(
                        onClick = onOpenDashboard,
                        modifier = Modifier
                            .size(40.dp)
                            .testTag("drawer_dashboard_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Dashboard,
                            contentDescription = "ড্যাশবোর্ড",
                            tint = Color.White,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                    if (dashboardUnreadCount > 0) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(top = 6.dp, end = 6.dp)
                                .size(9.dp)
                                .clip(CircleShape)
                                .background(PortalSaffron)
                        )
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
        }
        Surface(
            shape = CircleShape,
            color = Color.White.copy(alpha = 0.14f)
        ) {
            IconButton(
                onClick = onCycleTheme,
                modifier = Modifier
                    .size(40.dp)
                    .testTag("drawer_theme_toggle")
            ) {
                Icon(
                    imageVector = themeIcon,
                    contentDescription = themeLabel,
                    tint = Color.White,
                    modifier = Modifier.size(22.dp)
                )
            }
        }
    }
}

@Composable
private fun DrawerDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        thickness = 1.dp,
        color = MaterialTheme.colorScheme.outlineVariant
    )
}

@Composable
private fun DrawerRow(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit
) {
    val background = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent
    val tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    val textColor = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 11.dp)
            .testTag("drawer_$label"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Box(modifier = Modifier.size(24.dp), contentAlignment = Alignment.Center) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(22.dp)
            )
        }
        Text(
            text = label,
            fontFamily = Kalpurush,
            fontSize = 16.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            color = textColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
