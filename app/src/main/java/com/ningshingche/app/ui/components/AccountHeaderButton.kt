package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.ningshingche.app.ui.theme.Kalpurush

@Composable
fun AccountHeaderButton(
    isSignedIn: Boolean,
    avatarUrl: String,
    onLoginClick: () -> Unit,
    onDashboardClick: () -> Unit,
    onProfileClick: () -> Unit,
    onLogoutClick: () -> Unit
) {
    var menuOpen by remember { mutableStateOf(false) }

    Box {
        IconButton(
            onClick = {
                if (isSignedIn) menuOpen = true else onLoginClick()
            },
            modifier = Modifier.testTag("signin_top_button")
        ) {
            if (isSignedIn && avatarUrl.isNotBlank()) {
                AsyncImage(
                    model = avatarUrl,
                    contentDescription = "অ্যাকাউন্ট",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .testTag("header_profile_picture")
                )
            } else {
                Icon(
                    imageVector = if (isSignedIn) Icons.Default.AccountCircle else Icons.Default.Person,
                    contentDescription = if (isSignedIn) "অ্যাকাউন্ট" else "সাইন ইন",
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }
        }

        DropdownMenu(
            expanded = menuOpen,
            onDismissRequest = { menuOpen = false }
        ) {
            DropdownMenuItem(
                text = {
                    Text("ড্যাশবোর্ড", fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
                },
                leadingIcon = { Icon(Icons.Default.Dashboard, contentDescription = null) },
                onClick = {
                    menuOpen = false
                    onDashboardClick()
                },
                modifier = Modifier.testTag("account_menu_dashboard")
            )
            DropdownMenuItem(
                text = {
                    Text("প্রোফাইল", fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
                },
                leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                onClick = {
                    menuOpen = false
                    onProfileClick()
                },
                modifier = Modifier.testTag("account_menu_profile")
            )
            DropdownMenuItem(
                text = {
                    Text("লগ আউট", fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
                },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null) },
                onClick = {
                    menuOpen = false
                    onLogoutClick()
                },
                modifier = Modifier.testTag("account_menu_logout")
            )
        }
    }
}
