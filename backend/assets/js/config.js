(function () {
  'use strict';

  /**
   * Browser-safe application configuration.
   *
   * IMPORTANT:
   * - The Supabase value below is a publishable browser key, never a service key.
   * - ImgBB requires its upload key in browser requests; restrict/rotate it in
   *   the provider dashboard if the project is ever transferred.
   * - Migration 004 validates dashboard credentials and permissions in Supabase.
   */
  window.NC_CONFIG = Object.freeze({
    app: Object.freeze({
      name: 'Ningshing Che',
      subtitle: 'Editorial Command Center',
      version: '1.9.0',
      websiteUrl: 'https://ningshingche.com',
      locale: 'en-BD',
      timeZone: 'Asia/Dhaka',
      sessionHours: 8,
      rememberedSessionDays: 7,
      defaultTheme: 'dark',
      defaultRoute: 'dashboard',
      defaultPageSize: 10,
      requestTimeoutMs: 20000
    }),

    supabase: Object.freeze({
      url: 'https://slcpvmpsynkqdozvlsii.supabase.co',
      publishableKey: 'sb_publishable_jqJACnQHmCMcGjt0kG6Sug_ddknIbAA',
      restPath: '/rest/v1',
      storagePath: '/storage/v1',
      pdfBucket: 'pdf-books',
      pdfMaxBytes: 32 * 1024 * 1024,
      musicBucket: 'music',
      musicMaxBytes: 32 * 1024 * 1024
    }),

    imgbb: Object.freeze({
      endpoint: 'https://api.imgbb.com/1/upload',
      apiKey: '576f654932a2b7398e765cf27d8c73d4',
      maxBytes: 32 * 1024 * 1024,
      acceptedTypes: Object.freeze([
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'image/bmp', 'image/avif', 'image/heic', 'image/heif'
      ])
    }),

    // Migration-only fallback. Once migration 004 installs dashboard_login,
    // credentials and roles come exclusively from Supabase.
    auth: Object.freeze({
      username: 'admin',
      passwordHash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
      displayName: 'Chief Editor',
      role: 'Super Admin'
    }),

    tables: Object.freeze({
      authors: 'authors',
      categories: 'categories',
      blogs: 'blogs',
      comments: 'comments',
      galleries: 'galleries',
      books: 'pdf_books',
      submissions: 'submitted_blogs',
      videos: 'videos',
      music: 'music_tracks',
      settings: 'settings',
      profiles: 'profiles',
      notifications: 'user_notifications',
      messages: 'admin_messages',
      languageFiles: 'app_language_files',
      // The forum, which lives in the app: threads, answers, and the categories
      // they are filed under. Migration 029 grants the dashboard select on all
      // three and gives each a dashboard-level RLS policy, which is what lets
      // this dashboard read a hidden thread for moderation.
      forum: 'forum_discussions',
      forumReplies: 'forum_replies',
      forumCategories: 'forum_categories'
    }),

    // The migration that first taught the database each menu key. A key the
    // allow-list does not know is a key `dashboard_save_role` drops without a
    // word, so the Users & Roles page names the file to run instead of letting
    // an editor tick a box that cannot be saved.
    menuMigrations: Object.freeze({
      'registered-users': '008_registered_users.sql',
      music: '014_music_tracks.sql',
      forum: '031_forum_menu_permission.sql'
    }),

    routes: Object.freeze([
      { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', group: 'overview' },
      { id: 'registered-users', label: 'Registered users', icon: 'fa-user-group', group: 'community' },
      { id: 'ru-users', label: 'Users', icon: 'fa-users', group: 'community', parent: 'registered-users' },
      { id: 'ru-articles', label: 'Articles', icon: 'fa-file-pen', group: 'community', parent: 'registered-users' },
      { id: 'ru-music', label: 'Music', icon: 'fa-music', group: 'community', parent: 'registered-users' },
      { id: 'ru-comments', label: 'Comments', icon: 'fa-comments', group: 'community', parent: 'registered-users' },
      { id: 'ru-messages', label: 'Messages', icon: 'fa-messages', group: 'community', parent: 'registered-users' },
      { id: 'ru-notifications', label: 'Notification', icon: 'fa-bell', group: 'community', parent: 'registered-users' },
      // The app's own page (সেরা অবদানকারী) mirrored into the dashboard. Its
      // permission follows its parent, like every other row in this menu.
      { id: 'ru-contributors', label: 'সেরা অবদানকারী', icon: 'fa-trophy', group: 'community', parent: 'registered-users' },
      { id: 'authors', label: 'Authors', icon: 'fa-user-pen', group: 'content' },
      { id: 'blogs', label: 'Blogs', icon: 'fa-newspaper', group: 'content' },
      { id: 'categories', label: 'Categories', icon: 'fa-layer-group', group: 'content' },
      { id: 'comments', label: 'Comments', icon: 'fa-comments', group: 'content' },
      // Reader-written, reader-answered, and moderated here: the forum sits with
      // Comments rather than under a menu of its own.
      { id: 'forum', label: 'Forum', icon: 'fa-comment-dots', group: 'content' },
      { id: 'galleries', label: 'Galleries', icon: 'fa-images', group: 'content' },
      { id: 'books', label: 'PDF Books', icon: 'fa-books', group: 'content' },
      { id: 'submissions', label: 'Submit Blogs', icon: 'fa-file-pen', group: 'content' },
      { id: 'videos', label: 'Videos', icon: 'fa-video', group: 'content' },
      { id: 'music', label: 'Music', icon: 'fa-music', group: 'content' },
      { id: 'analytics', label: 'Analytics', icon: 'fa-chart-mixed', group: 'system' },
      { id: 'settings', label: 'Settings', icon: 'fa-gear', group: 'system' },
      // Top level on purpose, and guarded by the Settings permission: a role that
      // can open Settings can edit language files, and there is no separate
      // 'languages' key for the database to validate.
      { id: 'languages', label: 'Languages', icon: 'fa-language', group: 'system', permission: 'settings' },
      { id: 'access-control', label: 'Users & Roles', icon: 'fa-user-shield', group: 'system' }
    ])
  });

  window.NC = window.NC || { views: {}, state: {} };
})();
