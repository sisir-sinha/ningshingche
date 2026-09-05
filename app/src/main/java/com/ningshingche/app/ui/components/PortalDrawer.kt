package com.ningshingche.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Login
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VolunteerActivism
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.ui.navigation.PortalNavigation
import com.ningshingche.app.ui.navigation.Screen
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalMaroon
import com.ningshingche.app.ui.theme.PortalSaffron

@Composable
fun PortalDrawerContent(
    currentRoute: String,
    isDark: Boolean,
    isSignedIn: Boolean,
    onNavigate: (String) -> Unit,
    onCategory: (String) -> Unit,
    onYear: (Int) -> Unit,
    onExternal: (String) -> Unit,
    onToggleTheme: () -> Unit,
    onShareApp: () -> Unit,
    onCloseDrawer: () -> Unit
) {
    var mainOpen by rememberSaveable { mutableStateOf(true) }
    var yearsOpen by rememberSaveable { mutableStateOf(false) }
    var categoriesOpen by rememberSaveable { mutableStateOf(false) }
    var portalOpen by rememberSaveable { mutableStateOf(false) }
    var appOpen by rememberSaveable { mutableStateOf(false) }

    ModalDrawerSheet(
        drawerContainerColor = MaterialTheme.colorScheme.surface,
        drawerContentColor = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.width(320.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (isDark) Color(0xFF111827) else PortalMaroon)
                    .padding(horizontal = 18.dp, vertical = 22.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    NingshingCheBrandLogo(size = 48.dp)
                    Column {
                        Text("নিংশিং চে", fontFamily = Kalpurush, fontWeight = FontWeight.Bold, color = Color.White, fontSize = 22.sp)
                        Text("বিষ্ণুপ্রিয়া মণিপুরি তথ্যকোষ", fontFamily = Kalpurush, color = PortalSaffron, fontSize = 12.sp)
                    }
                }
            }

            CollapsibleSection("প্রধান পাতা", expanded = mainOpen, onToggle = { mainOpen = !mainOpen }) {
                DrawerRow("ঘর", Icons.Default.Home, currentRoute == Screen.Home.route) {
                    onCloseDrawer(); onNavigate(Screen.Home.route)
                }
                DrawerRow("ফিচার্ড", Icons.Default.Star, currentRoute == Screen.Featured.route) {
                    onCloseDrawer(); onNavigate(Screen.Featured.route)
                }
                DrawerRow("অন্বেষণ", Icons.Default.Explore, currentRoute == Screen.Explore.route) {
                    onCloseDrawer(); onNavigate(Screen.Explore.route)
                }
                DrawerRow("PDF আর্কাইভ", Icons.Default.PictureAsPdf, currentRoute == Screen.PdfArchive.route) {
                    onCloseDrawer(); onNavigate(Screen.PdfArchive.route)
                }
                DrawerRow("অনুসন্ধান", Icons.Default.Search, currentRoute == Screen.Search.route) {
                    onCloseDrawer(); onNavigate(Screen.Search.route)
                }
                DrawerRow("সংরক্ষিত", Icons.Default.Bookmark, currentRoute == Screen.Bookmarks.route) {
                    onCloseDrawer(); onNavigate(Screen.Bookmarks.route)
                }
            }

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            CollapsibleSection(
                "অনলাইন চে — বার্ষিক সংখ্যা",
                expanded = yearsOpen,
                onToggle = { yearsOpen = !yearsOpen }
            ) {
                PortalNavigation.years.forEach { item ->
                    DrawerRow(item.label, Icons.Default.CalendarMonth, false) {
                        onCloseDrawer()
                        item.year?.let(onYear)
                    }
                }
            }

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            CollapsibleSection("বিভাগসমূহ", expanded = categoriesOpen, onToggle = { categoriesOpen = !categoriesOpen }) {
                PortalNavigation.categories.forEach { item ->
                    DrawerRow(
                        item.label,
                        Icons.AutoMirrored.Filled.MenuBook,
                        currentRoute.contains(item.categorySlug.orEmpty())
                    ) {
                        onCloseDrawer()
                        item.categorySlug?.let(onCategory)
                    }
                }
            }

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            CollapsibleSection("পোর্টাল", expanded = portalOpen, onToggle = { portalOpen = !portalOpen }) {
                DrawerRow("আমার সম্পর্কে", Icons.Default.Info, currentRoute == Screen.About.route) {
                    onCloseDrawer(); onNavigate(Screen.About.route)
                }
                DrawerRow("লেখক", Icons.Default.People, currentRoute == Screen.AuthorsDirectory.route) {
                    onCloseDrawer(); onNavigate(Screen.AuthorsDirectory.route)
                }
                DrawerRow("সামাজিক কার্যকলাপ", Icons.Default.VolunteerActivism, currentRoute == Screen.SocialActivities.route) {
                    onCloseDrawer(); onNavigate(Screen.SocialActivities.route)
                }
                DrawerRow("লেখা জমাদান", Icons.Default.Language, false) {
                    onCloseDrawer(); onExternal("https://ningshingche.com/blog_submission")
                }
                DrawerRow("ningshingche.com", Icons.Default.Language, false) {
                    onCloseDrawer(); onExternal("https://ningshingche.com")
                }
            }

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            CollapsibleSection("অ্যাপ", expanded = appOpen, onToggle = { appOpen = !appOpen }) {
                if (isSignedIn) {
                    DrawerRow("ড্যাশবোর্ড", Icons.Default.Dashboard, currentRoute == Screen.UserDashboard.route) {
                        onCloseDrawer(); onNavigate(Screen.UserDashboard.route)
                    }
                    DrawerRow("প্রোফাইল", Icons.Default.Person, currentRoute == Screen.UserProfile.route) {
                        onCloseDrawer(); onNavigate(Screen.UserProfile.route)
                    }
                    DrawerRow("বিজ্ঞপ্তি", Icons.Default.Notifications, currentRoute == Screen.UserInbox.route) {
                        onCloseDrawer(); onNavigate(Screen.UserInbox.route)
                    }
                } else {
                    DrawerRow("সাইন ইন", Icons.AutoMirrored.Filled.Login, currentRoute == Screen.Login.route) {
                        onCloseDrawer(); onNavigate(Screen.Login.route)
                    }
                }
                DrawerRow("AI সহকারী", Icons.Default.AutoAwesome, currentRoute == Screen.AiAssistant.route) {
                    onCloseDrawer(); onNavigate(Screen.AiAssistant.route)
                }
                DrawerRow("সেটিংস", Icons.Default.Settings, currentRoute == Screen.Settings.route) {
                    onCloseDrawer(); onNavigate(Screen.Settings.route)
                }
                DrawerRow(
                    if (isDark) "লাইট থিম" else "ডার্ক থিম",
                    if (isDark) Icons.Default.LightMode else Icons.Default.DarkMode,
                    false
                ) {
                    onToggleTheme()
                }
                DrawerRow("অ্যাপ শেয়ার করুন", Icons.Default.Share, false) {
                    onCloseDrawer(); onShareApp()
                }
            }

            Text(
                text = "কালপুরুষ ফন্ট • নিংশিং চে পোর্টাল",
                fontFamily = Kalpurush,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.sp,
                modifier = Modifier
                    .padding(20.dp)
                    .align(Alignment.CenterHorizontally)
            )
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun CollapsibleSection(
    title: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .testTag("drawer_section_$title"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = title,
            fontFamily = Kalpurush,
            color = PortalSaffron,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp
        )
        Icon(
            imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
            contentDescription = if (expanded) "সংকুচিত করুন" else "প্রসারিত করুন",
            tint = PortalSaffron,
            modifier = Modifier.size(20.dp)
        )
    }
    AnimatedVisibility(visible = expanded) {
        Column { content() }
    }
}

@Composable
private fun DrawerRow(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit
) {
    NavigationDrawerItem(
        icon = {
            Icon(
                icon,
                contentDescription = label,
                tint = if (selected) PortalSaffron else MaterialTheme.colorScheme.onSurfaceVariant
            )
        },
        label = {
            Text(
                text = label,
                fontFamily = Kalpurush,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                fontSize = 15.sp
            )
        },
        selected = selected,
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        colors = NavigationDrawerItemDefaults.colors(
            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
            unselectedContainerColor = Color.Transparent
        ),
        modifier = Modifier
            .padding(horizontal = 10.dp, vertical = 1.dp)
            .testTag("drawer_$label")
    )
}
