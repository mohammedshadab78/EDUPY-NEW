// firebase-config.js
// Client-side Firebase Initialization and Database Helper Library


// Fallback configuration for local development if serverless function is not run (e.g. static server)
const LOCAL_FALLBACK = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Global references for other scripts to use after initialization
window.auth = null;
window.db = null;
let resolveReady;
window.firebaseReady = new Promise((resolve) => {
  resolveReady = resolve;
});

// List of public pages that do NOT require logging in
const PUBLIC_PAGES = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/forgot-password.html'
];

// Determine if the current page is public
function isCurrentPagePublic() {
  const path = window.location.pathname;
  return PUBLIC_PAGES.some(p => path === p || path.endsWith(p));
}

// 1. Fetch config and initialize Firebase
async function initializeFirebaseApp() {
  let config = LOCAL_FALLBACK;
  
  try {
    const response = await fetch('/api/firebase-config');
    if (response.ok) {
      const serverConfig = await response.json();
      // Only override if we got valid values from the API
      if (serverConfig.apiKey && serverConfig.apiKey !== "") {
        config = serverConfig;
      }
    }
  } catch (error) {
    console.warn("Could not fetch Firebase config from serverless endpoint, using local fallback.", error);
  }

  // Ensure we have at least projectId or apiKey to initialize
  if (!config.projectId || config.projectId === "") {
    console.error("Firebase Configuration is missing! Please set up Vercel environment variables or edit the LOCAL_FALLBACK in firebase-config.js.");
    showConfigErrorOverlay();
    resolveReady();
    return;
  }

  // Initialize Firebase Compat
  firebase.initializeApp(config);
  window.auth = firebase.auth();
  window.db = firebase.firestore();

  // Resolve initialization promise
  resolveReady();

  // Initialize auth state checker
  setupAuthStateListener();
}

// 2. Auth State Listener & Redirection Logic
function setupAuthStateListener() {
  window.auth.onAuthStateChanged(async (user) => {
    const isPublic = isCurrentPagePublic();
    
    if (user) {
      console.log("Logged in user:", user.email);
      
      // Load user profile and update navbar
      try {
        const userDocRef = window.db.collection('users').doc(user.uid);
        let userDoc = await userDocRef.get();
        
        if (!userDoc.exists) {
          // Create user document if it doesn't exist
          const initialData = {
            name: user.displayName || user.email.split('@')[0],
            email: user.email,
            level: 1,
            scores: {},
            badges: [],
            streak: 1,
            lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
            role: "student"
          };
          await userDocRef.set(initialData);
          userDoc = await userDocRef.get();
        }

        const userData = userDoc.data();
        
        // Check if account is banned
        if (userData.banned === true) {
          alert("Your account has been suspended by an Administrator.");
          window.auth.signOut().then(() => {
            window.location.href = 'login.html';
          });
          return;
        }

        // Backfill email in Firestore if missing
        if (!userData.email && user.email) {
          await userDocRef.update({ email: user.email });
          userData.email = user.email;
        }
        
        // Calculate streak and update last login
        await checkAndUpdateStreak(user.uid, userData);

        // Update navbars with user profile information
        updateNavbars(user, userData);

        // Migrate local storage to Firestore if not already done
        if (!userData.migratedFromLocal) {
          await migrateLocalStorageToFirestore(user.uid);
        }

        // Redirect logged-in users away from auth pages
        const path = window.location.pathname;
        if (path.endsWith('login.html') || path.endsWith('register.html')) {
          window.location.href = 'dashboard.html';
        }
      } catch (e) {
        console.error("Error fetching user data from Firestore:", e);
      }
    } else {
      console.log("No user logged in.");
      // Clear navbars for guests (public pages)
      updateNavbars(null, null);
      
      // If page is protected, redirect to login
      if (!isPublic) {
        window.location.href = 'login.html';
      }
    }
  });
}

function updateNavbars(user, userData) {
  // Inject CSS styles for the navbar and terminal first
  injectNavStyles();

  // Select all possible navbar wrappers on different pages
  const desktopNavs = document.querySelectorAll('.nav-links, .nav-actions, #navLinks, #nav-links');
  const mobileDrawers = document.querySelectorAll('.mobile-drawer, #mobileDrawer');

  // Rebuild navigation links dynamically
  rebuildNavbarLinks(user);

  if (user && userData) {
    const name = userData.name || user.displayName || user.email.split('@')[0];
    const isAdmin = userData.role === 'admin';

    // Update Desktop Navbars
    desktopNavs.forEach(nav => {
      // Avoid duplicate injections
      if (nav.querySelector('.nav-user-info')) return;

      // Remove any static login/register links if they exist
      const loginLinks = nav.querySelectorAll('a[href*="login.html"], a[href*="register.html"]');
      loginLinks.forEach(lnk => lnk.remove());

      // Create a nice premium container for auth status
      const authContainer = document.createElement('div');
      authContainer.className = 'nav-user-info';
      authContainer.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; flex-wrap: nowrap;';

      // Create Dropdown Container
      const dropdownWrap = document.createElement('div');
      dropdownWrap.className = 'user-profile-dropdown';

      // Trigger Button
      const triggerBtn = document.createElement('button');
      triggerBtn.className = 'profile-trigger-btn';
      triggerBtn.innerHTML = `<span>👋 Hi, <strong style="color: var(--purple, #6C63FF)">${name}</strong></span><span class="chevron-icon">▼</span>`;
      dropdownWrap.appendChild(triggerBtn);

      // Menu
      const menu = document.createElement('div');
      menu.className = 'profile-dropdown-menu';

      // Dashboard Item
      const dashItem = document.createElement('a');
      dashItem.href = 'dashboard.html';
      dashItem.className = 'profile-dropdown-item';
      dashItem.innerHTML = '📊 Dashboard';
      menu.appendChild(dashItem);

      // Admin Item
      if (isAdmin) {
        const adminItem = document.createElement('a');
        adminItem.href = 'admin.html';
        adminItem.className = 'profile-dropdown-item admin-item';
        adminItem.innerHTML = '🔑 Admin Panel';
        menu.appendChild(adminItem);
      }

      // Divider
      const divider = document.createElement('div');
      divider.className = 'profile-dropdown-divider';
      menu.appendChild(divider);

      // Logout Item
      const logoutItem = document.createElement('button');
      logoutItem.className = 'profile-dropdown-item logout-item';
      logoutItem.innerHTML = '🚪 Logout';
      logoutItem.addEventListener('click', () => {
        window.auth.signOut().then(() => {
          window.location.href = 'index.html';
        });
      });
      menu.appendChild(logoutItem);

      dropdownWrap.appendChild(menu);
      authContainer.appendChild(dropdownWrap);

      // Toggle dropdown on click
      triggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownWrap.classList.toggle('open');
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        dropdownWrap.classList.remove('open');
      });

      nav.appendChild(authContainer);
    });

    // Update Mobile Drawer (specifically on home.html)
    mobileDrawers.forEach(drawer => {
      if (drawer.querySelector('.drawer-user-info')) return;

      const divider = document.createElement('div');
      divider.className = 'drawer-divider';
      drawer.appendChild(divider);

      const userInfo = document.createElement('div');
      userInfo.className = 'drawer-user-info';
      userInfo.style.cssText = 'padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.5rem;';

      const greeting = document.createElement('div');
      greeting.style.cssText = 'font-size: 0.85rem; font-weight: 800; color: var(--text);';
      greeting.innerHTML = `Logged in as: <span style="color: var(--purple)">${name}</span>`;
      userInfo.appendChild(greeting);

      const dashLink = document.createElement('a');
      dashLink.href = 'dashboard.html';
      dashLink.className = 'drawer-link';
      dashLink.innerHTML = '📊 Dashboard';
      userInfo.appendChild(dashLink);

      if (isAdmin) {
        const adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.className = 'drawer-link';
        adminLink.style.color = 'var(--gold-dk)';
        adminLink.innerHTML = '🔑 Admin Panel';
        userInfo.appendChild(adminLink);
      }

      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'drawer-run-btn';
      logoutBtn.style.cssText = 'background: rgba(255, 107, 107, 0.15); color: var(--coral-dk); margin-top: 5px;';
      logoutBtn.innerHTML = '🚪 Logout';
      logoutBtn.addEventListener('click', () => {
        window.auth.signOut().then(() => {
          window.location.href = 'index.html';
        });
      });
      userInfo.appendChild(logoutBtn);

      drawer.appendChild(userInfo);
    });
  } else {
    // If guest, ensure login link is present on public pages
    desktopNavs.forEach(nav => {
      // Clear logged in elements
      const loggedElements = nav.querySelectorAll('.nav-user-info');
      loggedElements.forEach(el => el.remove());

      if (isCurrentPagePublic() && !nav.querySelector('a[href*="login.html"]')) {
        const loginBtn = document.createElement('a');
        loginBtn.href = 'login.html';
        loginBtn.className = 'nav-btn primary';
        loginBtn.innerHTML = '🔑 Log In';
        nav.appendChild(loginBtn);
      }
    });
  }
}

// 3a. Rebuild Navigation Links dynamically to keep all HTML pages uniform
function rebuildNavbarLinks(user) {
  // Define our standardized global list of links
  const links = [
    {
      id: 'home',
      href: 'index.html',
      label: 'Home',
      icon: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
    },
    {
      id: 'editor',
      href: 'home.html',
      label: 'Open Editor',
      icon: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`
    },
    {
      id: 'notes',
      href: 'notes.html',
      label: 'Notes',
      icon: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
    },
    {
      id: 'assessments',
      href: 'assessments.html',
      label: 'Assessments',
      icon: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
    },
    {
      id: 'puzzles',
      href: 'puzzles.html',
      label: 'Puzzles',
      icon: `🧩`
    },
    {
      id: 'projects',
      href: 'projects.html',
      label: 'Visualizer',
      icon: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
    }
  ];

  if (user) {
    links.push({
      id: 'dashboard',
      href: 'dashboard.html',
      label: 'Dashboard',
      icon: `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
    });
  }

  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const isHomeHtml = currentPath === 'home.html';
  const isIndexHtml = currentPath === 'index.html' || currentPath === '';

  // 1. Rebuild Desktop/Topnav containers
  const desktopContainers = document.querySelectorAll('.nav-links, .nav-actions, #navLinks, #nav-links');
  desktopContainers.forEach(container => {
    // Preserve language selector wrap, theme wrap, or nav user info if they are in the container
    const langToggle = container.querySelector('.lang-toggle');
    const themeSelectorWrap = container.querySelector('.theme-selector-wrap');
    const navUserInfo = container.querySelector('.nav-user-info');

    // Clear it
    container.innerHTML = '';

    // Rebuild links
    links.forEach(lnk => {
      const a = document.createElement('a');
      a.href = lnk.href;
      
      // Determine classes
      if (isHomeHtml) {
        a.className = 'nav-link-btn';
      } else {
        a.className = 'nav-btn';
        if (lnk.id === 'editor' && isIndexHtml) {
          a.classList.add('primary'); // Match index.html main CTA style
        }
      }

      // Is it active?
      const isActive = currentPath === lnk.href || 
                       (lnk.href === 'index.html' && isIndexHtml);
      
      if (isActive) {
        a.classList.add('active');
      }

      // Create Icon
      const iconSpan = document.createElement('span');
      iconSpan.className = 'btn-icon';
      if (lnk.icon.startsWith('<svg')) {
        iconSpan.innerHTML = lnk.icon;
      } else {
        iconSpan.textContent = lnk.icon;
      }

      a.appendChild(iconSpan);
      a.appendChild(document.createTextNode(' ' + lnk.label));
      container.appendChild(a);
    });

    // Restore preserved elements
    if (langToggle) container.appendChild(langToggle);
    if (themeSelectorWrap) container.appendChild(themeSelectorWrap);
    if (navUserInfo) container.appendChild(navUserInfo);
  });

  // 2. Rebuild Mobile Drawer (if it exists)
  const mobileDrawers = document.querySelectorAll('.mobile-drawer, #mobileDrawer');
  mobileDrawers.forEach(drawer => {
    // Preserve run button, dividers, and user info
    const drawerRunBtn = drawer.querySelector('.drawer-run-btn, #drawerRunBtn');
    const divider = drawer.querySelector('.drawer-divider');
    const drawerUserInfo = drawer.querySelector('.drawer-user-info');

    // Clear the drawer
    drawer.innerHTML = '';

    // Rebuild links for mobile drawer
    links.forEach(lnk => {
      const a = document.createElement('a');
      a.href = lnk.href;
      a.className = 'drawer-link';

      const isActive = currentPath === lnk.href || 
                       (lnk.href === 'index.html' && isIndexHtml);
      if (isActive) {
        a.style.color = 'var(--accent)'; // Highlight on mobile drawer
      }

      const iconSpan = document.createElement('span');
      iconSpan.style.marginRight = '8px';
      if (lnk.icon.startsWith('<svg')) {
        iconSpan.innerHTML = lnk.icon;
        const svg = iconSpan.querySelector('svg');
        if (svg) {
          svg.setAttribute('width', '16');
          svg.setAttribute('height', '16');
        }
      } else {
        iconSpan.textContent = lnk.icon;
      }

      a.appendChild(iconSpan);
      a.appendChild(document.createTextNode(' ' + lnk.label));
      drawer.appendChild(a);
    });

    // Restore preserved
    if (divider) drawer.appendChild(divider);
    if (drawerRunBtn) drawer.appendChild(drawerRunBtn);
    if (drawerUserInfo) drawer.appendChild(drawerUserInfo);
  });
}


// 4. Streak Calculation Logic
async function checkAndUpdateStreak(uid, userData) {
  const now = new Date();
  
  // Try parsing lastLogin from Firestore (can be timestamp or serverValue)
  let lastLoginDate = null;
  if (userData.lastLogin) {
    if (typeof userData.lastLogin.toDate === 'function') {
      lastLoginDate = userData.lastLogin.toDate();
    } else {
      lastLoginDate = new Date(userData.lastLogin);
    }
  }

  let newStreak = userData.streak || 0;

  if (lastLoginDate) {
    // Check calendar day difference
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastLoginDay = new Date(lastLoginDate.getFullYear(), lastLoginDate.getMonth(), lastLoginDate.getDate());
    const diffTime = Math.abs(today - lastLoginDay);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      // Consecutive day login - increment streak!
      newStreak += 1;
      showFirebaseToast(`🔥 Streak count: ${newStreak} days! Keep it up!`);
    } else if (diffDays > 1) {
      // Missed a day - reset streak to 1
      newStreak = 1;
      showFirebaseToast(`👋 Welcome back! Streak reset to 1 day.`);
    }
    // If diffDays === 0 (same day), streak remains identical
  } else {
    // First login ever
    newStreak = 1;
  }

  // Save updated streak and timestamp
  await window.db.collection('users').doc(uid).update({
    streak: newStreak,
    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// 5. Migrate LocalStorage Progress to Firestore
async function migrateLocalStorageToFirestore(uid) {
  try {
    const localBadges = JSON.parse(localStorage.getItem("edupy_badges") || "{}");
    const localScores = JSON.parse(localStorage.getItem("edupy_scores") || "{}");
    const localBookmarks = JSON.parse(localStorage.getItem("edupy_bookmarks") || "[]");
    const localRead = JSON.parse(localStorage.getItem("edupy_read") || "[]");

    const userDocRef = window.db.collection('users').doc(uid);
    const doc = await userDocRef.get();
    const serverData = doc.data();

    // Prepare merged badges
    const badgeNamesMap = {
      "L1": "Seedling Badge",
      "L2": "Logic Spark Badge",
      "L3": "Word Wizard Badge",
      "L4": "Loop Legend Badge",
      "L5": "Code Alchemist Badge",
      "L6": "Python Master Badge"
    };

    let badgesSet = new Set(serverData.badges || []);
    Object.keys(localBadges).forEach(lvlId => {
      if (localBadges[lvlId] && badgeNamesMap[lvlId]) {
        badgesSet.add(badgeNamesMap[lvlId]);
      }
    });

    // Merge scores
    const scoresMerged = { ...(serverData.scores || {}) };
    Object.keys(localScores).forEach(lvlId => {
      const lvlNum = lvlId.replace('L', '');
      const percentage = Math.round((localScores[lvlId] / 10) * 100);
      const scoreKey = `level${lvlNum}`;
      if (percentage > (scoresMerged[scoreKey] || 0)) {
        scoresMerged[scoreKey] = percentage;
      }
    });

    // Merge Bookmarks & Read items
    const bookmarksMerged = Array.from(new Set([...(serverData.bookmarks || []), ...localBookmarks]));
    const readMerged = Array.from(new Set([...(serverData.readItems || []), ...localRead]));

    // Determine current level based on completed quizzes
    let highestLevelPassed = 0;
    Object.keys(localBadges).forEach(lvlId => {
      const lvlNum = parseInt(lvlId.replace('L', ''));
      if (localBadges[lvlId] && lvlNum > highestLevelPassed) {
        highestLevelPassed = lvlNum;
      }
    });
    const levelToSet = Math.min(6, Math.max(serverData.level || 1, highestLevelPassed + 1));

    // Update Firestore user document
    await userDocRef.update({
      badges: Array.from(badgesSet),
      scores: scoresMerged,
      bookmarks: bookmarksMerged,
      readItems: readMerged,
      level: levelToSet,
      migratedFromLocal: true
    });

    console.log("Local Storage progress migrated successfully!");
  } catch (error) {
    console.error("Migration from local storage failed:", error);
  }
}

// 6. Common helper toast to display messages
function showFirebaseToast(msg, duration = 3500) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  } else {
    console.log(`[Toast Notification]: ${msg}`);
  }
}

// 7. Inject styles for perfect alignment & mobile responsiveness
function injectNavStyles() {
  const styleId = 'dynamic-nav-styles';
  if (document.getElementById(styleId)) return;

  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.innerHTML = `
    /* CSS overrides for unified navbar responsiveness */
    .nav-user-info {
      display: flex !important;
      align-items: center !important;
      gap: 0.6rem !important;
      margin-left: 0.75rem !important;
      flex-wrap: nowrap !important;
    }
    
    /* User Profile Dropdown styles */
    .user-profile-dropdown {
      position: relative;
      display: inline-block;
    }

    .profile-trigger-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(108, 99, 255, 0.08) !important;
      border: 1px solid rgba(108, 99, 255, 0.2) !important;
      color: #1E1B4B !important;
      padding: 0.42rem 1rem !important;
      border-radius: 99px !important;
      font-family: 'Inter', sans-serif !important;
      font-size: 0.85rem !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
      height: 38px !important;
      box-sizing: border-box !important;
    }

    .profile-trigger-btn:hover {
      background: rgba(108, 99, 255, 0.12) !important;
      border-color: rgba(108, 99, 255, 0.35) !important;
      transform: translateY(-1px) !important;
    }

    .profile-trigger-btn strong {
      color: var(--purple, #6C63FF) !important;
    }

    .profile-trigger-btn .chevron-icon {
      font-size: 0.65rem !important;
      transition: transform 0.2s ease !important;
      color: var(--purple, #6C63FF) !important;
      display: inline-block !important;
    }

    /* Open state chevron rotation */
    .user-profile-dropdown.open .profile-trigger-btn .chevron-icon {
      transform: rotate(180deg) !important;
    }

    .profile-dropdown-menu {
      display: none; /* hidden by default */
      position: absolute !important;
      top: calc(100% + 8px) !important;
      right: 0 !important;
      background: white !important;
      min-width: 180px !important;
      border-radius: 14px !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.08), 0 3px 10px rgba(108, 99, 255, 0.05) !important;
      border: 1.5px solid rgba(108, 99, 255, 0.12) !important;
      padding: 0.5rem 0 !important;
      z-index: 1000 !important;
      transform-origin: top right !important;
      animation: dropdownFadeIn 0.2s ease !important;
    }

    @keyframes dropdownFadeIn {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(-4px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .user-profile-dropdown.open .profile-dropdown-menu {
      display: block !important;
    }

    .profile-dropdown-item {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      padding: 0.6rem 1.1rem !important;
      color: #4b5563 !important;
      text-decoration: none !important;
      font-size: 0.85rem !important;
      font-weight: 600 !important;
      border: none !important;
      background: none !important;
      width: 100% !important;
      text-align: left !important;
      cursor: pointer !important;
      box-sizing: border-box !important;
      transition: all 0.15s ease !important;
    }

    .profile-dropdown-item:hover {
      background: rgba(108, 99, 255, 0.06) !important;
      color: var(--purple, #6C63FF) !important;
    }

    .profile-dropdown-item.admin-item {
      color: var(--gold-dk, #C17D0A) !important;
    }
    .profile-dropdown-item.admin-item:hover {
      background: rgba(245, 166, 35, 0.06) !important;
    }

    .profile-dropdown-divider {
      height: 1px !important;
      background: rgba(108, 99, 255, 0.08) !important;
      margin: 0.4rem 0 !important;
    }

    .profile-dropdown-item.logout-item {
      color: #DC2626 !important;
    }
    .profile-dropdown-item.logout-item:hover {
      background: rgba(220, 38, 38, 0.06) !important;
    }

    /* Responsive adjustment for Mobile screens */
    @media (max-width: 1080px) {
      .user-profile-dropdown {
        width: 100% !important;
      }
      .profile-trigger-btn {
        width: 100% !important;
        justify-content: space-between !important;
        height: 42px !important;
      }
      .profile-dropdown-menu {
        position: static !important;
        display: none !important;
        width: 100% !important;
        box-shadow: none !important;
        border: none !important;
        border-top: 1px solid rgba(108, 99, 255, 0.08) !important;
        background: transparent !important;
        margin-top: 0.5rem !important;
        padding: 0 !important;
        animation: none !important;
      }
      /* On mobile, open state expands inline */
      .user-profile-dropdown.open .profile-dropdown-menu {
        display: block !important;
      }
      .profile-dropdown-item {
        padding: 0.65rem 1.5rem !important;
        border-radius: 8px !important;
      }
    }
    
    header.nav, nav.navbar {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      height: 70px !important;
      padding: 0 2rem !important;
    }
    header.nav .nav-links, nav.navbar .nav-links {
      display: flex !important;
      align-items: center !important;
      gap: 0.5rem !important;
      flex-wrap: nowrap !important;
    }

    /* Enhanced Nav Buttons from index.html (Globally applied) */
    header.nav .nav-btn, nav.navbar .nav-btn, .nav-link-btn, 
    header.nav .nav-user-info .nav-btn, nav.navbar .nav-user-info .nav-btn {
      padding: 0.5rem 1.1rem !important;
      border-radius: 999px !important;
      font-size: 0.82rem !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      text-decoration: none !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 0.4rem !important;
      transition: all 0.3s ease !important;
      background: rgba(255, 255, 255, 0.08) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      border: 1px solid rgba(108, 99, 255, 0.3) !important;
      color: #6C63FF !important;
      position: relative !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      height: 38px !important;
    }

    /* Shimmer effect inside buttons */
    header.nav .nav-btn::after, nav.navbar .nav-btn::after, .nav-link-btn::after {
      content: '' !important;
      position: absolute !important;
      inset: 0 !important;
      border-radius: 999px !important;
      background: linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%) !important;
      opacity: 0 !important;
      transition: opacity 0.3s ease !important;
      pointer-events: none !important;
    }

    header.nav .nav-btn:hover, nav.navbar .nav-btn:hover, .nav-link-btn:hover {
      background: rgba(108, 99, 255, 0.12) !important;
      border-color: #6C63FF !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 6px 20px rgba(108, 99, 255, 0.15) !important;
      color: #6C63FF !important;
    }

    header.nav .nav-btn:hover::after, nav.navbar .nav-btn:hover::after, .nav-link-btn:hover::after {
      opacity: 1 !important;
      animation: shimmer 0.8s ease-out forwards !important;
    }

    header.nav .nav-btn.primary, nav.navbar .nav-btn.primary,
    header.nav .nav-btn.active, nav.navbar .nav-btn.active, .nav-link-btn.active {
      background: rgba(108, 99, 255, 0.2) !important;
      border-color: rgba(108, 99, 255, 0.5) !important;
      color: #6C63FF !important;
      box-shadow: 0 2px 10px rgba(108, 99, 255, 0.12) !important;
    }

    header.nav .nav-btn.primary:hover, nav.navbar .nav-btn.primary:hover,
    header.nav .nav-btn.active:hover, nav.navbar .nav-btn.active:hover, .nav-link-btn.active:hover {
      background: rgba(108, 99, 255, 0.28) !important;
      border-color: #6C63FF !important;
      box-shadow: 0 8px 24px rgba(108, 99, 255, 0.22) !important;
      transform: translateY(-2px) !important;
    }

    header.nav .nav-btn:active, nav.navbar .nav-btn:active, .nav-link-btn:active {
      transform: translateY(1px) scale(0.97) !important;
      transition: transform 0.08s ease !important;
    }

    header.nav .nav-btn .btn-icon, nav.navbar .nav-btn .btn-icon, .nav-link-btn .btn-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 1.2rem !important;
      height: 1.2rem !important;
      flex-shrink: 0 !important;
      transition: transform 0.3s ease !important;
    }

    header.nav .nav-btn:hover .btn-icon, nav.navbar .nav-btn:hover .btn-icon, .nav-link-btn:hover .btn-icon {
      transform: scale(1.2) rotate(-8deg) !important;
    }

    @keyframes shimmer {
      0% { transform: translateX(-100%); opacity: 0; }
      40% { opacity: 1; }
      100% { transform: translateX(100%); opacity: 0; }
    }

    /* Standardized Brand Logo (Globally Uniform) */
    .logo, .nav-brand {
      display: flex !important;
      align-items: center !important;
      gap: 0.65rem !important;
      text-decoration: none !important;
      font-family: 'Plus Jakarta Sans', sans-serif !important;
    }

    .logo-icon, .nav-logo, .brand-icon {
      width: 2.4rem !important;
      height: 2.4rem !important;
      border-radius: 14px !important;
      background: linear-gradient(135deg, #6C63FF, #FF6B6B) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-weight: 800 !important;
      font-size: 1.1rem !important;
      color: #fff !important;
      box-shadow: 0 4px 0 #4B44CC, 0 8px 16px rgba(108, 99, 255, 0.3) !important;
      transition: transform 0.3s ease, box-shadow 0.3s ease !important;
      box-sizing: border-box !important;
    }
    
    .brand-icon svg {
      width: 16px !important;
      height: 16px !important;
      stroke: #fff !important;
    }

    .logo:hover .logo-icon, .nav-brand:hover .nav-logo, .nav-brand:hover .brand-icon {
      transform: translateY(-2px) scale(1.05) !important;
      box-shadow: 0 6px 0 #4B44CC, 0 12px 22px rgba(108, 99, 255, 0.4) !important;
    }

    .logo span, .nav-title, .brand-name {
      font-family: 'Plus Jakarta Sans', sans-serif !important;
      font-size: 1.25rem !important;
      font-weight: 800 !important;
      color: #6C63FF !important;
      letter-spacing: 0.02em !important;
    }
    
    /* Hide page specific tagline details next to brand in header on mobile */
    .logo span span, .nav-title span {
      font-weight: 400 !important;
    }
    @media (max-width: 580px) {
      .logo span span, .nav-title span {
        display: none !important;
      }
    }

    /* Red Logout button style override */
    header.nav .nav-user-info .logout-btn, nav.navbar .nav-user-info .logout-btn {
      background: rgba(255, 107, 107, 0.12) !important;
      color: #CC4444 !important;
      border: 1px solid rgba(255, 107, 107, 0.35) !important;
    }
    header.nav .nav-user-info .logout-btn:hover, nav.navbar .nav-user-info .logout-btn:hover {
      background: rgba(255, 107, 107, 0.22) !important;
      border-color: #CC4444 !important;
      color: #CC4444 !important;
    }

    /* Uniform Media Query Breakpoint at 1080px */
    @media (max-width: 1080px) {
      header.nav, nav.navbar {
        padding: 0 1.25rem !important;
        position: relative !important;
      }
      
      .hamburger {
        display: flex !important;
        flex-direction: column !important;
        justify-content: center !important;
        align-items: center !important;
        gap: 4px !important;
        width: 38px !important;
        height: 38px !important;
        background: rgba(108, 99, 255, 0.08) !important;
        border: none !important;
        border-radius: 8px !important;
        cursor: pointer !important;
        z-index: 1001 !important;
      }
      .hamburger span {
        display: block !important;
        width: 20px !important;
        height: 2px !important;
        background: #6C63FF !important;
        border-radius: 2px !important;
        transition: transform 0.25s ease, opacity 0.25s ease !important;
      }
      .hamburger.active span:nth-child(1) {
        transform: translateY(6px) rotate(45deg) !important;
      }
      .hamburger.active span:nth-child(2) {
        opacity: 0 !important;
      }
      .hamburger.active span:nth-child(3) {
        transform: translateY(-6px) rotate(-45deg) !important;
      }

      header.nav .nav-links, nav.navbar .nav-links {
        display: none !important;
        flex-direction: column !important;
        align-items: stretch !important;
        position: absolute !important;
        top: 70px !important;
        left: 0 !important;
        right: 0 !important;
        background: rgba(255, 255, 255, 0.98) !important;
        backdrop-filter: blur(25px) !important;
        -webkit-backdrop-filter: blur(25px) !important;
        border-bottom: 2px solid rgba(108, 99, 255, 0.12) !important;
        padding: 1.5rem !important;
        gap: 0.8rem !important;
        box-shadow: 0 12px 30px rgba(0,0,0,0.08) !important;
        z-index: 1000 !important;
        max-height: calc(100vh - 70px) !important;
        overflow-y: auto !important;
      }
      header.nav .nav-links.open, nav.navbar .nav-links.open {
        display: flex !important;
      }
      header.nav .nav-links .nav-btn, nav.navbar .nav-links .nav-btn {
        width: 100% !important;
        justify-content: center !important;
        height: 42px !important;
      }
      .nav-user-info {
        flex-direction: column !important;
        width: 100% !important;
        margin-left: 0 !important;
        padding-top: 1rem !important;
        border-top: 1px solid rgba(108, 99, 255, 0.12) !important;
        gap: 0.8rem !important;
      }
      .nav-user-info span.nav-greeting {
        width: 100% !important;
        justify-content: center !important;
        height: 38px !important;
      }
      .nav-user-info .nav-btn {
        width: 100% !important;
        justify-content: center !important;
        height: 42px !important;
      }
    }
  `;
  document.head.appendChild(styleEl);
}

// 8. Responsive hamburger logic injection
function setupResponsiveNav() {
  const header = document.querySelector('.nav, .navbar, .topnav');
  if (!header) return;

  const style = window.getComputedStyle(header);
  if (style.position === 'static') {
    header.style.position = 'relative';
  }

  let hamburger = header.querySelector('.hamburger');
  
  // Clone hamburger to strip static/clashing listeners
  if (hamburger) {
    const newHamburger = hamburger.cloneNode(true);
    hamburger.parentNode.replaceChild(newHamburger, hamburger);
    hamburger = newHamburger;
  }

  const navContainer = header.querySelector('.nav-links, .nav-actions, #navLinks, #nav-links');
  const isPlayground = window.location.pathname.endsWith('home.html');

  if (isPlayground) {
    const drawer = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('drawerOverlay');
    
    if (hamburger && drawer) {
      hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = drawer.classList.toggle('open');
        if (overlay) overlay.classList.toggle('open', isOpen);
        hamburger.classList.toggle('open', isOpen); // home.html style uses 'open' class
      });
      
      if (overlay) {
        overlay.addEventListener('click', () => {
          drawer.classList.remove('open');
          overlay.classList.remove('open');
          hamburger.classList.remove('open');
        });
      }
    }
  } else {
    // Standard pages using dropdown
    if (!hamburger && navContainer) {
      hamburger = document.createElement('button');
      hamburger.className = 'hamburger';
      hamburger.setAttribute('aria-label', 'Toggle Menu');
      hamburger.innerHTML = '<span></span><span></span><span></span>';
      header.appendChild(hamburger);
    }
    
    if (hamburger && navContainer) {
      hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = navContainer.classList.toggle('open');
        hamburger.classList.toggle('active', isOpen);
      });
      
      document.addEventListener('click', (e) => {
        if (!header.contains(e.target)) {
          navContainer.classList.remove('open');
          hamburger.classList.remove('active');
        }
      });
    }
  }

  // Close menus on link click
  const menus = document.querySelectorAll('.nav-links, .nav-actions, #navLinks, #nav-links, .mobile-drawer, #mobileDrawer');
  menus.forEach(menu => {
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        menu.classList.remove('open');
        if (hamburger) {
          hamburger.classList.remove('active');
          hamburger.classList.remove('open');
        }
        const overlay = document.getElementById('drawerOverlay');
        if (overlay) overlay.classList.remove('open');
      });
    });
  });
}

// 9. Easter egg clicks listener
function setupEasterEggLogoClicks() {
  let logoClicks = 0;
  let logoClickTimeout;
  
  const logoElements = document.querySelectorAll('.nav-logo, .logo-icon, .brand-icon, .nav-brand, .logo');
  logoElements.forEach(logo => {
    logo.addEventListener('click', (e) => {
      logoClicks++;
      if (logoClicks >= 5) {
        e.preventDefault();
        e.stopPropagation();
        logoClicks = 0;
        openSecretTerminal();
      }
      clearTimeout(logoClickTimeout);
      logoClickTimeout = setTimeout(() => {
        logoClicks = 0;
      }, 2500);
    });
  });
}

// 10. Easter egg Terminal Controller
function openSecretTerminal() {
  let overlay = document.getElementById('secret-terminal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'secret-terminal-overlay';
    overlay.className = 'secret-terminal-overlay';
    overlay.innerHTML = `
      <div class="secret-terminal-window">
        <div class="terminal-header">
          <span>⚙️ EduPy System Shell v1.2.0</span>
          <button class="terminal-close" id="terminal-close-btn">&times;</button>
        </div>
        <div class="terminal-body" id="terminal-body">
          <div class="terminal-output" id="terminal-output">Welcome to the secret EduPy Developer Console.
Type 'help' for a list of available systems.
          </div>
          <div class="terminal-input-line">
            <span class="terminal-prompt">edupy:~$</span>
            <input type="text" class="terminal-input" id="terminal-input" autofocus autocomplete="off" spellcheck="false">
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
      .secret-terminal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .secret-terminal-overlay.active {
        opacity: 1;
        pointer-events: auto;
      }
      .secret-terminal-window {
        width: 92%;
        max-width: 620px;
        height: 420px;
        background: #050508;
        border: 2px solid #6c63ff;
        border-radius: 14px;
        box-shadow: 0 0 35px rgba(108, 99, 255, 0.45);
        font-family: 'JetBrains Mono', 'Courier New', Courier, monospace;
        color: #39ff14;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      
      .secret-terminal-window.theme-green { color: #39ff14; border-color: #6c63ff; box-shadow: 0 0 30px rgba(108, 99, 255, 0.45); }
      .secret-terminal-window.theme-amber { color: #ffb000; border-color: #ffb000; box-shadow: 0 0 30px rgba(255, 176, 0, 0.4); }
      .secret-terminal-window.theme-cyan  { color: #00f3ff; border-color: #00f3ff; box-shadow: 0 0 30px rgba(0, 243, 255, 0.4); }
      .secret-terminal-window.theme-cyber { color: #ff0055; border-color: #ff0055; box-shadow: 0 0 30px rgba(255, 0, 85, 0.45); }

      .terminal-header {
        background: #111116;
        border-bottom: 1px solid rgba(108, 99, 255, 0.2);
        padding: 0.6rem 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.78rem;
        color: #8f9cae;
        font-weight: 600;
      }
      .terminal-close {
        background: none;
        border: none;
        color: #8f9cae;
        font-size: 1.3rem;
        cursor: pointer;
        line-height: 1;
      }
      .terminal-close:hover {
        color: #ff5555;
      }
      .terminal-body {
        flex-grow: 1;
        padding: 1.2rem;
        overflow-y: auto;
        font-size: 0.85rem;
        line-height: 1.45;
        display: flex;
        flex-direction: column;
        background: #050508;
      }
      .terminal-output {
        white-space: pre-wrap;
        margin-bottom: 0.5rem;
        flex-grow: 1;
      }
      .terminal-input-line {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        border-top: 1px solid rgba(108, 99, 255, 0.15);
        padding-top: 0.8rem;
      }
      .terminal-prompt {
        color: #6C63FF;
        font-weight: 700;
      }
      .terminal-input {
        background: none;
        border: none;
        color: inherit;
        font-family: inherit;
        font-size: inherit;
        outline: none;
        flex-grow: 1;
        caret-color: currentColor;
      }
      
      .flying-element {
        position: fixed;
        font-size: 2.5rem;
        pointer-events: none;
        z-index: 1000000;
        animation: flyAcross 2s linear forwards;
      }
      @keyframes flyAcross {
        0% { left: -50px; top: 80%; transform: rotate(0deg); }
        50% { top: 20%; transform: rotate(180deg); }
        100% { left: calc(100% + 50px); top: 50%; transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styleEl);

    document.getElementById('terminal-close-btn').onclick = () => {
      overlay.classList.remove('active');
    };
    
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    };

    const terminalInput = document.getElementById('terminal-input');
    const terminalOutput = document.getElementById('terminal-output');
    
    let commandHistory = [];
    let historyIndex = -1;
    let expectingPasscode = false;

    terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmdText = terminalInput.value.trim();
        terminalInput.value = '';
        if (cmdText) {
          commandHistory.push(cmdText);
          historyIndex = commandHistory.length;
          
          if (expectingPasscode) {
            expectingPasscode = false;
            terminalOutput.innerHTML += `\n${cmdText}`;
            if (cmdText === 'antigravity') {
              terminalOutput.innerHTML += `\n<span style="color: #39ff14">Bypassing credential validation...</span>\n<span style="color: #39ff14">Access Granted. Opening Administrative Mainframe...</span>`;
              setTimeout(() => {
                overlay.classList.remove('active');
                window.location.href = 'admin.html';
              }, 1500);
            } else {
              terminalOutput.innerHTML += `\n<span style="color: #ff3333">Incorrect passcode. Override aborted.</span>`;
            }
            scrollToBottom();
            return;
          }

          const cleanCmd = cmdText.toLowerCase();
          terminalOutput.innerHTML += `\n<span style="color: #6C63FF">edupy:~$</span> ${cmdText}`;
          const output = [];

          if (cleanCmd === 'help') {
            output.push(
              `Available Commands:`,
              `  help          - Display this assistance list.`,
              `  import this   - Output the Zen of Python philosophy.`,
              `  import gravity- Defy physics (import antigravity).`,
              `  admin         - Request access to the Admin Panel.`,
              `  theme <name>  - Change console colors (green, amber, cyan, cyber).`,
              `  clear         - Clear terminal display.`,
              `  exit          - Close this terminal session.`
            );
          } else if (cleanCmd === 'import this' || cleanCmd === 'this') {
            output.push(
              `The Zen of Python, by Tim Peters:`,
              ``,
              `Beautiful is better than ugly.`,
              `Explicit is better than implicit.`,
              `Simple is better than complex.`,
              `Complex is better than complicated.`,
              `Flat is better than nested.`,
              `Sparse is better than dense.`,
              `Readability counts.`,
              `Special cases aren't special enough to break the rules.`,
              `Although practicality beats purity.`,
              `Errors should never pass silently.`,
              `Unless explicitly silenced.`,
              `In the face of ambiguity, refuse the temptation to guess.`,
              `There should be one-- and preferably only one --obvious way to do it.`,
              `Although that way may not be obvious at first unless you're Dutch.`,
              `Now is better than never.`,
              `Although never is often better than *right* now.`,
              `If the implementation is hard to explain, it's a bad idea.`,
              `If the implementation is easy to explain, it may be a good idea.`,
              `Namespaces are one honking great idea -- let's do more of those!`
            );
          } else if (cleanCmd === 'import antigravity' || cleanCmd === 'antigravity' || cleanCmd === 'import gravity') {
            output.push(
              `🚀 def gravity(): return None`,
              `Defying gravity... Loading Easter Egg animation...`
            );
            launchFlyingEmoji('🐍');
            launchFlyingEmoji('✈️');
            
            setTimeout(() => {
              window.open('https://xkcd.com/353/', '_blank');
            }, 1200);
          } else if (cleanCmd === 'admin') {
            const user = window.auth ? window.auth.currentUser : null;
            if (user) {
              window.db.collection('users').doc(user.uid).get().then(doc => {
                if (doc.exists && doc.data().role === 'admin') {
                  terminalOutput.innerHTML += `\n<span style="color: #39ff14">Authenticated as Administrator. Access Granted.</span>`;
                  setTimeout(() => {
                    overlay.classList.remove('active');
                    window.location.href = 'admin.html';
                  }, 1000);
                } else {
                  terminalOutput.innerHTML += `\n<span style="color: #ffaa00">User role is 'student'. Access denied.</span>`;
                  terminalOutput.innerHTML += `\n<span style="color: #ffaa00">Passcode required for manual override.</span>`;
                  terminalOutput.innerHTML += `\n<span style="color: #8f9cae">Enter developer key: </span>`;
                  expectingPasscode = true;
                  scrollToBottom();
                }
              }).catch(e => {
                terminalOutput.innerHTML += `\n<span style="color: #ff3333">Error accessing database: ${e.message}</span>`;
                terminalOutput.innerHTML += `\nEnter developer key for override: `;
                expectingPasscode = true;
                scrollToBottom();
              });
            } else {
              output.push(
                `No user session active. Please sign in to the platform first.`
              );
            }
          } else if (cleanCmd.startsWith('theme ')) {
            const themeName = cleanCmd.replace('theme ', '').trim();
            const windowEl = overlay.querySelector('.secret-terminal-window');
            windowEl.className = 'secret-terminal-window';
            
            if (['green', 'amber', 'cyan', 'cyber'].includes(themeName)) {
              windowEl.classList.add('theme-' + themeName);
              output.push(`Terminal color set to: ${themeName.toUpperCase()}`);
            } else {
              output.push(`Unknown theme: '${themeName}'. Try: green, amber, cyan, cyber.`);
            }
          } else if (cleanCmd === 'clear') {
            terminalOutput.innerHTML = `Console cleared.\nType 'help' for options.`;
          } else if (cleanCmd === 'exit') {
            overlay.classList.remove('active');
          } else {
            output.push(
              `bash: command not found: '${cmdText}'.`,
              `Type 'help' to see list of valid systems.`
            );
          }

          if (output.length > 0) {
            terminalOutput.innerHTML += `\n` + output.join(`\n`);
          }
          scrollToBottom();
        }
      } else if (e.key === 'ArrowUp') {
        if (historyIndex > 0) {
          historyIndex--;
          terminalInput.value = commandHistory[historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        if (historyIndex < commandHistory.length - 1) {
          historyIndex++;
          terminalInput.value = commandHistory[historyIndex];
        } else {
          historyIndex = commandHistory.length;
          terminalInput.value = '';
        }
      }
    });
  }

  overlay.classList.add('active');
  setTimeout(() => {
    document.getElementById('terminal-input').focus();
  }, 100);
}

function scrollToBottom() {
  const terminalBody = document.getElementById('terminal-body');
  if (terminalBody) {
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }
}

function launchFlyingEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'flying-element';
  el.textContent = emoji;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Database Seeder for Default MCQ Questions and Visualizer Projects
async function seedProjectData(force = false) {
  await window.firebaseReady;
  if (!window.db) return;

  try {
    // 1. Check Questions
    const questionsSnap = force ? { empty: true } : await window.db.collection('questions').limit(1).get();
    if (questionsSnap.empty) {
      console.log("Seeding default MCQ questions to Firestore...");
      const batch = window.db.batch();
      
      const defaultQuestions = [
        // Level 1
        { levelId:"L1", q:"Which function is used to display output in Python?", opts:["show()","display()","print()","output()"], ans:2 },
        { levelId:"L1", q:"What is the correct way to assign a string to a variable?", opts:['name = [Hello]','name = Hello','name = "Hello"','name = {Hello}'], ans:2 },
        { levelId:"L1", q:"What does the <code class='q-code'>input()</code> function return by default?", opts:["integer","float","string","boolean"], ans:2 },
        { levelId:"L1", q:"What will <code class='q-code'>print(2 + 3)</code> output?", opts:["2 + 3","23","5","Error"], ans:2 },
        { levelId:"L1", q:"Which operator performs integer (floor) division in Python?", opts:["/","//","%","**"], ans:1 },
        { levelId:"L1", q:"What is the output of <code class='q-code'>print(10 % 3)</code>?", opts:["3","1","0","10"], ans:1 },
        { levelId:"L1", q:"Which of these is a valid Python variable name?", opts:["2name","my-var","my_var","for"], ans:2 },
        { levelId:"L1", q:"What is the data type of <code class='q-code'>3.14</code>?", opts:["int","str","bool","float"], ans:3 },
        { levelId:"L1", q:"What will <code class='q-code'>print(2 ** 4)</code> output?", opts:["8","6","16","24"], ans:2 },
        { levelId:"L1", q:"How do you convert the string <code class='q-code'>\"42\"</code> to an integer?", opts:['str("42")','int("42")','float("42")','num("42")'], ans:1 },
        { levelId:"L1", q:'What will <code class="q-code">print("Hello" + " " + "World")</code> output?', opts:["Hello World","HelloWorld",'"Hello World"',"Error"], ans:0 },
        { levelId:"L1", q:"Which symbol starts a comment in Python?", opts:["//","/*  */","<!--  -->","#"], ans:3 },

        // Level 2
        { levelId:"L2", q:"What keyword starts a conditional statement in Python?", opts:["when","check","if","condition"], ans:2 },
        { levelId:"L2", q:'<code class="q-code">x = 7; print("odd" if x % 2 != 0 else "even")</code> — what prints?', opts:["even","odd","7","Error"], ans:1 },
        { levelId:"L2", q:"What does <code class='q-code'>elif</code> stand for?", opts:["else if","else in loop","end if","elif is invalid"], ans:0 },
        { levelId:"L2", q:"The <code class='q-code'>and</code> operator returns True when…", opts:["either side is True","both sides are True","neither side is True","both sides are False"], ans:1 },
        { levelId:"L2", q:"What does <code class='q-code'>not True</code> evaluate to?", opts:["True","1","False","None"], ans:2 },
        { levelId:"L2", q:"Which comparison operator checks equality?", opts:["=","===","==",":="], ans:2 },
        { levelId:"L2", q:"What does <code class='q-code'>bool(0)</code> return?", opts:["True","0","False","None"], ans:2 },
        { levelId:"L2", q:'<code class="q-code">x = 5; y = 10; print(x &lt; y and y &lt; 20)</code> — output?', opts:["False","Error","5","True"], ans:3 },
        { levelId:"L2", q:'<code class="q-code">not (True and False)</code> evaluates to?', opts:["False","None","True","Error"], ans:2 },
        { levelId:"L2", q:"Which statement correctly checks if a variable <code class='q-code'>x</code> is None?", opts:["x == None","x is None","x = None","x equals None"], ans:1 },
        { levelId:"L2", q:'What will <code class="q-code">print("yes") if 3 &gt; 2 else print("no")</code> output?', opts:["no","yes","True","3"], ans:1 },
        { levelId:"L2", q:"What does the <code class='q-code'>or</code> operator return True for?", opts:["only when both are True","when at least one is True","when both are False","never"], ans:1 },

        // Level 3
        { levelId:"L3", q:'What does <code class="q-code">"hello".upper()</code> return?', opts:["HELLO","Hello","hello","hELLO"], ans:0 },
        { levelId:"L3", q:'What is <code class="q-code">len("Python")</code>?', opts:["5","6","7","4"], ans:1 },
        { levelId:"L3", q:'What is <code class="q-code">"abc"[1]</code>?', opts:["a","b","c","ab"], ans:1 },
        { levelId:"L3", q:'What does <code class="q-code">"hello world".split()</code> return?', opts:["('hello','world')","['hello world']","['hello','world']","{hello, world}"], ans:2 },
        { levelId:"L3", q:'What does <code class="q-code">[1,2,3,4][1:3]</code> return?', opts:["[1,2,3]","[2,3,4]","[2,3]","[1,3]"], ans:2 },
        { levelId:"L3", q:'What does <code class="q-code">"hello".replace("l","r")</code> return?', opts:["herlo","herro","hello","Error"], ans:1 },
        { levelId:"L3", q:"How do you add an element to the <em>end</em> of a list?", opts:["list.add(x)","list.push(x)","list.append(x)","list.insert(x)"], ans:2 },
        { levelId:"L3", q:'What does <code class="q-code">[1,2,3].pop()</code> return?', opts:["1","2","3","[1,2]"], ans:2 },
        { levelId:"L3", q:'What will <code class="q-code">"abc"[-1]</code> return?', opts:["a","b","c","Error"], ans:2 },
        { levelId:"L3", q:'What does <code class="q-code">"hello".startswith("he")</code> return?', opts:["False","True",'"he"',"Error"], ans:1 },
        { levelId:"L3", q:'What does <code class="q-code">[1,2,3] + [4,5]</code> return?', opts:["[1,2,3,4,5]","Error","[1,2,3,[4,5]]","[5,7]"], ans:0 },
        { levelId:"L3", q:'What is <code class="q-code">len([1, [2,3], 4])</code>?', opts:["4","3","5","2"], ans:1 },

        // Level 4
        { levelId:"L4", q:'What does <code class="q-code">range(5)</code> generate?', opts:["1,2,3,4,5","0,1,2,3,4","0,1,2,3,4,5","1,2,3,4"], ans:1 },
        { levelId:"L4", q:"What keyword immediately stops a loop?", opts:["stop","exit","break","return"], ans:2 },
        { levelId:"L4", q:"What keyword skips the rest of an iteration and goes to the next?", opts:["skip","continue","next","pass"], ans:1 },
        { levelId:"L4", q:'What is the last value of <code class="q-code">i</code> in: <code class="q-code">for i in range(1, 5)</code>?', opts:["5","4","6","1"], ans:1 },
        { levelId:"L4", q:'How many times does <code class="q-code">for i in range(0,10,2)</code> loop?', opts:["10","2","5","4"], ans:2 },
        { levelId:"L4", q:'What is <code class="q-code">"*" * 4</code>?', opts:["****","* * * *","4","Error"], ans:0 },
        { levelId:"L4", q:'What does <code class="q-code">while True:</code> with a <code class="q-code">break</code> inside do?', opts:["Runs forever","Never runs","Runs until break executes","Syntax error"], ans:2 },
        { levelId:"L4", q:'<code class="q-code">for i in range(3): print(i)</code> — what is printed (space-separated)?', opts:["1 2 3","0 1 2","0 1 2 3","3"], ans:1 },
        { levelId:"L4", q:"How many total iterations in: <code class='q-code'>for i in range(2): for j in range(3)</code>?", opts:["5","6","3","2"], ans:1 },
        { levelId:"L4", q:'What does <code class="q-code">range(10, 0, -1)</code> start with?', opts:["0","10","9","1"], ans:1 },
        { levelId:"L4", q:"Which loop is best when you don't know the number of iterations in advance?", opts:["for","while","do-while","foreach"], ans:1 },
        { levelId:"L4", q:'<code class="q-code">s=0\nfor i in range(1,4): s+=i\nprint(s)</code> — output?', opts:["3","6","10","4"], ans:1 },

        // Level 5
        { levelId:"L5", q:"What keyword is used to define a function in Python?", opts:["function","func","def","define"], ans:2 },
        { levelId:"L5", q:"What does <code class='q-code'>return</code> do inside a function?", opts:["Prints the value","Sends value back to the caller","Stops the program","Creates a variable"], ans:1 },
        { levelId:"L5", q:'<code class="q-code">def f(x): return x*2\nprint(f(5))</code> — output?', opts:["5","10","25","f(5)"], ans:1 },
        { levelId:"L5", q:'How do you access the value with key <code class="q-code">"name"</code> from <code class="q-code">d = {"name":"Alex"}</code>?', opts:["d.name","d[\"name\"]","d(name)","d->name"], ans:1 },
        { levelId:"L5", q:'What is <code class="q-code">len({"a":1, "b":2, "c":3})</code>?', opts:["1","3","6","2"], ans:1 },
        { levelId:"L5", q:'What does <code class="q-code">d.get("key", "default")</code> return if "key" does not exist?', opts:["None","Error",'"default"',"0"], ans:2 },
        { levelId:"L5", q:"What is a lambda function?", opts:["A named function","An anonymous one-line function","A recursive function","A class method"], ans:1 },
        { levelId:"L5", q:'<code class="q-code">f = lambda x: x**2\nprint(f(4))</code> — output?', opts:["2","8","16","Error"], ans:2 },
        { levelId:"L5", q:'What does <code class="q-code">d.keys()</code> return?', opts:["Values","Key-value pairs","All keys","Length"], ans:2 },
        { levelId:"L5", q:"What is a default parameter?", opts:["A parameter with no type hint","A parameter with a pre-set value","A global variable","A return type"], ans:1 },
        { levelId:"L5", q:'What does <code class="q-code">d.update({"x": 10})</code> do?', opts:["Prints d","Replaces d entirely","Adds or updates key 'x'","Deletes key 'x'"], ans:2 },
        { levelId:"L5", q:"What makes a function <em>recursive</em>?", opts:["It uses a for loop","It calls itself","It has no return statement","It uses global variables"], ans:1 },

        // Level 6
        { levelId:"L6", q:'What does <code class="q-code">sorted([3,1,4,1,5])</code> return?', opts:["[5,4,3,1,1]","[1,1,3,4,5]","[3,1,4,1,5]","Error"], ans:1 },
        { levelId:"L6", q:'What is the output of <code class="q-code">list(set([1,2,2,3,3,3]))</code>?', opts:["[1,2,2,3,3,3]","[1,2,3]","{1,2,3}","Error"], ans:1 },
        { levelId:"L6", q:'What does <code class="q-code">[x*2 for x in range(4)]</code> produce?', opts:["[0,2,4,6]","[2,4,6,8]","[1,2,3,4]","[0,1,2,3]"], ans:0 },
        { levelId:"L6", q:"What is a <code class='q-code'>try/except</code> block used for?", opts:["Repeating code","Defining functions","Handling runtime errors","Creating loops"], ans:2 },
        { levelId:"L6", q:'Does <code class="q-code">"racecar" == "racecar"[::-1]</code> evaluate to True?', opts:["No, False","Yes, True","Error","None"], ans:1 },
        { levelId:"L6", q:'What does <code class="q-code">enumerate([\'a\',\'b\',\'c\'])</code> produce?', opts:["[0,1,2]","Indexed (index, value) pairs","['a','b','c']","3"], ans:1 },
        { levelId:"L6", q:'What does <code class="q-code">zip([1,2],[3,4])</code> produce?', opts:["[1,2,3,4]","[(1,3),(2,4)]","{1:3,2:4}","Error"], ans:1 },
        { levelId:"L6", q:'What does <code class="q-code">"hello world".count("l")</code> return?', opts:["2","3","1","4"], ans:1 },
        { levelId:"L6", q:'<code class="q-code">import random; random.randint(1,10)</code> — what is returned?', opts:["A float 1.0–10.0","An int from 1–10 inclusive","An int from 0–9","A string"], ans:1 },
        { levelId:"L6", q:"What is an f-string in Python?", opts:["A file-type string","A formatted string literal","A function string","A frozen string"], ans:1 },
        { levelId:"L6", q:'What does <code class="q-code">sorted("python")</code> return?', opts:["['python']","Error","['h','n','o','p','t','y']","'hnopty'"], ans:2 },
        { levelId:"L6", q:'What is the output of <code class="q-code">print(type([]).__name__)</code>?', opts:["array","tuple","set","list"], ans:3 }
      ];

      let idx = 0;
      for (const q of defaultQuestions) {
        const docId = `default_q_${q.levelId}_${idx}`;
        const docRef = window.db.collection('questions').doc(docId);
        batch.set(docRef, {
          levelId: q.levelId,
          q: q.q,
          opts: q.opts,
          ans: q.ans,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        idx++;
      }
      await batch.commit();
      console.log("MCQ questions seeding complete!");
    }

    // 2. Check Projects
    const projectsSnap = force ? { empty: true } : await window.db.collection('projects').limit(1).get();
    if (projectsSnap.empty) {
      console.log("Seeding default Projects to Firestore...");
      const batch = window.db.batch();

      const defaultProjects = [
        {
          id: "guess",
          title: "Guessing Game",
          tagline: "I'm thinking of a number 1-100! Can you get it?",
          tags: ["random", "loops", "conditionals"],
          code: [
            { n:1,  html: `<span class="tk-kw">import</span> random` },
            { n:2,  html: `` },
            { n:3,  html: `<span class="tk-cmt"># Pick a secret number</span>` },
            { n:4,  html: `secret = random.<span class="tk-fn">randint</span>(<span class="tk-num">1</span>, <span class="tk-num">100</span>)` },
            { n:5,  html: `attempts = <span class="tk-num">0</span>` },
            { n:6,  html: `` },
            { n:7,  html: `<span class="tk-kw">print</span>(<span class="tk-str">"I'm thinking of a number 1-100!"</span>)` },
            { n:8,  html: `` },
            { n:9,  html: `<span class="tk-kw">while</span> <span class="tk-kw">True</span>:   <span class="tk-cmt"># keep looping until correct</span>` },
            { n:10, html: `    guess = <span class="tk-fn">int</span>(<span class="tk-fn">input</span>(<span class="tk-str">"Your guess: "</span>))` },
            { n:11, html: `    attempts += <span class="tk-num">1</span>` },
            { n:12, html: `` },
            { n:13, html: `    <span class="tk-kw">if</span> secret <span class="tk-op">&gt;</span> guess:` },
            { n:14, html: `        <span class="tk-kw">print</span>(<span class="tk-str">"Too low! Go higher ↑"</span>)` },
            { n:15, html: `    <span class="tk-kw">elif</span> secret <span class="tk-op">&lt;</span> guess:` },
            { n:16, html: `        <span class="tk-kw">print</span>(<span class="tk-str">"Too high! Go lower ↓"</span>)` },
            { n:17, html: `    <span class="tk-kw">else</span>:   <span class="tk-cmt"># must be equal!</span>` },
            { n:18, html: `        <span class="tk-kw">print</span>(<span class="tk-str">f"You got it in {attempts} tries!"</span>)` },
            { n:19, html: `        <span class="tk-kw">break</span>  <span class="tk-cmt"># exit the loop</span>` }
          ],
          steps: [
            { lines:[1],    explain:`Line 1: We import the random module. This gives us access to Python's built-in tools for generating random numbers.`, concept:`📦 import = loading a toolbox`, uiAction:'none' },
            { lines:[3,4],  explain:`Lines 3–4: random.randint(1,100) picks a secret number between 1 and 100. It's stored in the variable "secret".`, concept:`🎲 variable = a labelled box that holds a value`, uiAction:'setSecret' },
            { lines:[5],    explain:`Line 5: attempts = 0. We start a counter at zero. Every time the player guesses, this number goes up by 1.`, concept:`🔢 counter variable — starts at 0`, uiAction:'none' },
            { lines:[7],    explain:`Line 7: print() sends a message to the screen. This is how the program talks to the user!`, concept:`📢 print() = show text on screen`, uiAction:'showMsg' },
            { lines:[9],    explain:`Line 9: while True — this starts an infinite loop! The program keeps asking for guesses until we use "break" to stop it.`, concept:`🔁 while loop = repeat until we say stop`, uiAction:'flashLoop' },
            { lines:[10],   explain:`Line 10: input() pauses and waits for the user to type. int() converts that text into a number we can compare.`, concept:`⌨️ input() + int() = read a number from user`, uiAction:'focusInput' },
            { lines:[11],   explain:`Line 11: attempts += 1 means "add 1 to attempts". Same as writing attempts = attempts + 1. The counter goes up!`, concept:`➕ += is shorthand for adding to a variable`, uiAction:'none' },
            { lines:[13,14],explain:`Lines 13–14: if secret > guess — the secret is bigger, so the guess is too LOW. Python runs the print("Too low!") line.`, concept:`🔍 if statement = a decision point in the code`, uiAction:'guessLow' },
            { lines:[15,16],explain:`Lines 15–16: elif secret < guess — the secret is smaller, so the guess is too HIGH. elif means "else if" — a second condition to check.`, concept:`🔀 elif = "else if" — another condition to try`, uiAction:'guessHigh' },
            { lines:[17,18,19], explain:`Lines 17–19: else means none of the above — so the guess must be exactly right! We print the win message and use break to exit the loop.`, concept:`🎉 else = "in every other case" — the final branch`, uiAction:'guessWin' }
          ]
        },
        {
          id: "calc",
          title: "Calculator App",
          tagline: "Build a graphical calculator and execute real math string expressions.",
          tags: ["functions", "eval", "try-except"],
          code: [
            { n:1,  html: `<span class="tk-cmt"># expression stores what user typed</span>` },
            { n:2,  html: `expression = <span class="tk-str">""</span>  <span class="tk-cmt"># start empty</span>` },
            { n:3,  html: `` },
            { n:4,  html: `<span class="tk-kw">def</span> <span class="tk-fn">on_button_click</span>(value):` },
            { n:5,  html: `    <span class="tk-kw">global</span> expression` },
            { n:6,  html: `` },
            { n:7,  html: `    <span class="tk-kw">if</span> value <span class="tk-op">==</span> <span class="tk-str">"C"</span>:   <span class="tk-cmt"># clear</span>` },
            { n:8,  html: `        expression = <span class="tk-str">""</span>` },
            { n:9,  html: `        display.<span class="tk-fn">set_text</span>(<span class="tk-str">"0"</span>)` },
            { n:10, html: `` },
            { n:11, html: `    <span class="tk-kw">elif</span> value <span class="tk-op">==</span> <span class="tk-str">"="</span>:   <span class="tk-cmt"># evaluate</span>` },
            { n:12, html: `        <span class="tk-kw">try</span>:` },
            { n:13, html: `            result = <span class="tk-fn">eval</span>(expression)` },
            { n:14, html: `            display.<span class="tk-fn">set_text</span>(result)` },
            { n:15, html: `            expression = <span class="tk-fn">str</span>(result)` },
            { n:16, html: `        <span class="tk-kw">except</span>:` },
            { n:17, html: `            display.<span class="tk-fn">set_text</span>(<span class="tk-str">"Error"</span>)` },
            { n:18, html: `` },
            { n:19, html: `    <span class="tk-kw">else</span>:   <span class="tk-cmt"># any digit or operator</span>` },
            { n:20, html: `        expression += value` },
            { n:21, html: `        display.<span class="tk-fn">set_text</span>(expression)` }
          ],
          steps: [
            { lines:[1,2],  explain:`Lines 1–2: We create a variable called expression that starts as an empty string "". It will build up as the user taps buttons.`, concept:`📝 string variable = holds text like "3+4"`, uiAction:'calcReset' },
            { lines:[4,5],  explain:`Lines 4–5: We define a function called on_button_click. A function is reusable code that runs whenever a button is pressed. "global" lets us modify expression from inside the function.`, concept:`🔧 def = define a reusable block of code`, uiAction:'none' },
            { lines:[7,8,9],explain:`Lines 7–9: if value == "C" — if the user pressed Clear, reset expression to "" and show "0" on the display.`, concept:`🧹 == means "is equal to" — checking a condition`, uiAction:'calcPressC' },
            { lines:[11,12,13],explain:`Lines 11–13: elif value == "=" — time to calculate! eval() takes our string "3+4" and computes the actual math answer: 7.`, concept:`🧮 eval() = run a string as real Python code`, uiAction:'calcPress3' },
            { lines:[14,15],explain:`Lines 14–15: We show the result on the display and also save it back into expression (so the user can keep calculating).`, concept:`📺 updating the display = changing what the user sees`, uiAction:'calcPressPlus' },
            { lines:[16,17],explain:`Lines 16–17: except catches errors — like if the user typed "3++" by mistake. Instead of crashing, we show "Error" politely!`, concept:`🛡️ try/except = handle mistakes gracefully`, uiAction:'none' },
            { lines:[19,20,21],explain:`Lines 19–21: else handles all other buttons (digits, operators). expression += value adds the new character to the end of the string. The display updates instantly!`, concept:`➕ string += appends a character to a string`, uiAction:'calcPress4' },
            { lines:[13],   explain:`Back to eval(): now expression might be "3+4". Python evaluates it and returns 7. The display updates and the user sees their answer!`, concept:`✨ eval("3+4") returns the integer 7`, uiAction:'calcEquals' }
          ]
        },
        {
          id: "todo",
          title: "To-Do Application",
          tagline: "Create tasks, toggle checklist status, and filter active items.",
          tags: ["lists", "dictionaries", "loops"],
          code: [
            { n:1,  html: `<span class="tk-cmt"># List to hold all tasks</span>` },
            { n:2,  html: `todos = []` },
            { n:3,  html: `next_id = <span class="tk-num">1</span>` },
            { n:4,  html: `` },
            { n:5,  html: `<span class="tk-kw">def</span> <span class="tk-fn">add_task</span>(text, priority):` },
            { n:6,  html: `    <span class="tk-kw">global</span> next_id` },
            { n:7,  html: `    task = {` },
            { n:8,  html: `        <span class="tk-str">"id"</span>: next_id,` },
            { n:9,  html: `        <span class="tk-str">"text"</span>: text,` },
            { n:10, html: `        <span class="tk-str">"done"</span>: <span class="tk-kw">False</span>,` },
            { n:11, html: `        <span class="tk-str">"priority"</span>: priority` },
            { n:12, html: `    }` },
            { n:13, html: `    todos.<span class="tk-fn">append</span>(task)` },
            { n:14, html: `    next_id += <span class="tk-num">1</span>` },
            { n:15, html: `` },
            { n:16, html: `<span class="tk-kw">def</span> <span class="tk-fn">toggle_done</span>(task_id):` },
            { n:17, html: `    <span class="tk-kw">for</span> task <span class="tk-kw">in</span> todos:` },
            { n:18, html: `        <span class="tk-kw">if</span> task[<span class="tk-str">"id"</span>] <span class="tk-op">==</span> task_id:` },
            { n:19, html: `            task[<span class="tk-str">"done"</span>] = <span class="tk-kw">not</span> task[<span class="tk-str">"done"</span>]` },
            { n:20, html: `` },
            { n:21, html: `<span class="tk-kw">def</span> <span class="tk-fn">get_active</span>():` },
            { n:22, html: `    <span class="tk-kw">return</span> [t <span class="tk-kw">for</span> t <span class="tk-kw">in</span> todos <span class="tk-kw">if</span> <span class="tk-kw">not</span> t[<span class="tk-str">"done"</span>]]` },
            { n:23, html: `` },
            { n:24, html: `<span class="tk-cmt"># Start: add first tasks</span>` },
            { n:25, html: `<span class="tk-fn">add_task</span>(<span class="tk-str">"Learn Python"</span>, <span class="tk-str">"high"</span>)` },
            { n:26, html: `<span class="tk-fn">add_task</span>(<span class="tk-str">"Build a project"</span>, <span class="tk-str">"med"</span>)` }
          ],
          steps: [
            { lines:[1,2,3], explain:`Lines 1–3: todos = [] creates an empty list. This is where ALL tasks will live. next_id is a counter so each task gets a unique number.`, concept:`📋 list = an ordered collection of items`, uiAction:'todoInit' },
            { lines:[5,6],   explain:`Lines 5–6: We define the add_task function. It takes two inputs: the text of the task and its priority level. "global" lets us update next_id.`, concept:`🔧 function parameters = values passed in when calling it`, uiAction:'none' },
            { lines:[7,8,9,10,11,12], explain:`Lines 7–12: We create a task dictionary — an object with named fields: id, text, done (starts False), and priority. Curly braces {} create a dictionary in Python.`, concept:`🗃️ dictionary = key:value pairs, like a labelled form`, uiAction:'todoHighlight' },
            { lines:[13,14], explain:`Lines 13–14: todos.append(task) adds the new task to the end of our list. Then next_id += 1 so the next task gets a different id number.`, concept:`➕ list.append() = add an item to the end of a list`, uiAction:'todoAdd' },
            { lines:[16,17,18,19], explain:`Lines 16–19: toggle_done loops through every task with "for". When it finds the right id, it flips done from False → True (or back). "not" reverses a boolean.`, concept:`🔄 for loop = visit each item in a list one by one`, uiAction:'todoCheck' },
            { lines:[21,22], explain:`Lines 21–22: get_active uses a list comprehension — a compact way to build a filtered list. It returns only tasks where done is False.`, concept:`⚡ list comprehension = filter a list in one line`, uiAction:'todoFilter' },
            { lines:[24,25,26], explain:`Lines 24–26: Finally we call add_task twice to start with some demo tasks. The function runs, creates dictionaries, appends them to the list.`, concept:`🚀 calling a function = running the code inside it`, uiAction:'todoAddTwo' }
          ]
        }
      ];

      for (const p of defaultProjects) {
        await window.db.collection('projects').doc(p.id).set({
          title: p.title,
          tagline: p.tagline,
          tags: p.tags,
          code: p.code,
          steps: p.steps,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      console.log("Projects seeding complete!");
    }
  } catch (err) {
    console.error("Database seeding failed:", err);
  }
}

// Expose seeder globally
window.seedProjectData = seedProjectData;

// Fullscreen configuration diagnostic overlay
function showConfigErrorOverlay() {
  const showOverlay = () => {
    document.body.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #F4F7FD; font-family: 'Inter', sans-serif; color: #1E1B4B; padding: 2rem; text-align: center; box-sizing: border-box;">
        <div style="background: white; padding: 3rem 2.2rem; border-radius: 24px; box-shadow: 0 12px 36px rgba(0,0,0,0.06); max-width: 500px; width: 100%; border: 1.5px solid rgba(108,99,255,0.15); box-sizing: border-box;">
          <span style="font-size: 3.2rem; margin-bottom: 1rem; display: block;">⚙️</span>
          <h2 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 1.45rem; font-weight: 800; margin-bottom: 0.8rem; background: linear-gradient(135deg, #6C63FF, #FF6B6B); -webkit-background-clip: text; background-clip: text; color: transparent;">Firebase Config Missing</h2>
          <p style="color: #5B5B7A; font-size: 0.92rem; line-height: 1.55; margin-bottom: 1.6rem; text-align: left;">
            EduPy has loaded, but its Firebase configuration credentials are missing. 
            <br><br>
            <strong>If deploying on Vercel:</strong>
            <br>
            Go to your Vercel Dashboard -> Project Settings -> Environment Variables, and add the required Firebase keys:
            <code style="display:block; background:#F1F5F9; padding:0.6rem; border-radius:8px; font-family:monospace; margin-top:0.4rem; font-size:0.75rem; color:#4B44CC;">FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_AUTH_DOMAIN...</code>
            Then trigger a new deployment for Vercel to bind these keys.
          </p>
          <a href="https://vercel.com" target="_blank" style="display: inline-flex; align-items: center; justify-content: center; background: #6C63FF; color: white; padding: 0.75rem 1.6rem; border-radius: 40px; font-weight: 700; text-decoration: none; font-size: 0.88rem; box-shadow: 0 4px 0 #4B44CC; transition: transform 0.15s;">Open Vercel Dashboard</a>
        </div>
      </div>
    `;
    document.body.style.opacity = '1';
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showOverlay);
  } else {
    showOverlay();
  }
}

// Initialize on DOMContentLoaded so dynamic elements are injected immediately
document.addEventListener("DOMContentLoaded", () => {
  // Check if Firebase core script is loaded first
  if (typeof firebase === 'undefined') {
    console.error("Firebase SDK script is missing! Please include Firebase Compat CDN scripts before firebase-config.js.");
    return;
  }
  initializeFirebaseApp();
  
  // Setup responsive nav and easter egg click listener after a small timeout
  setTimeout(() => {
    setupResponsiveNav();
    setupEasterEggLogoClicks();
  }, 120);
});

