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
    // Display a gentle toast to developer/user
    showFirebaseToast("Firebase credentials not configured!");
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

// 3. Dynamic Navbar Injections
function updateNavbars(user, userData) {
  // Inject CSS styles for the navbar and terminal first
  injectNavStyles();

  // Select all possible navbar wrappers on different pages
  const desktopNavs = document.querySelectorAll('.nav-links, .nav-actions, #navLinks, #nav-links');
  const mobileDrawers = document.querySelectorAll('.mobile-drawer, #mobileDrawer');

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

      // Greeting badge
      const greeting = document.createElement('span');
      greeting.className = 'nav-greeting';
      greeting.innerHTML = `👋 Hi, <strong style="color: var(--purple, #6C63FF)">${name}</strong>`;
      authContainer.appendChild(greeting);

      // Dashboard Link
      const dashBtn = document.createElement('a');
      dashBtn.href = 'dashboard.html';
      dashBtn.className = 'nav-btn';
      dashBtn.innerHTML = '📊 Dashboard';
      // If in home.html, adapt class to match playground theme
      if (nav.className.includes('nav-actions')) {
        dashBtn.className = 'nav-link-btn';
        dashBtn.style.marginLeft = '4px';
      }
      authContainer.appendChild(dashBtn);

      // Admin Link if role is admin
      if (isAdmin) {
        const adminBtn = document.createElement('a');
        adminBtn.href = 'admin.html';
        adminBtn.className = 'nav-btn admin-btn';
        adminBtn.style.borderColor = 'var(--gold, #F5A623)';
        adminBtn.style.color = 'var(--gold-dk, #C17D0A)';
        adminBtn.style.background = 'rgba(245, 166, 35, 0.08)';
        adminBtn.innerHTML = '🔑 Admin';
        if (nav.className.includes('nav-actions')) {
          adminBtn.className = 'nav-link-btn admin-btn';
        }
        authContainer.appendChild(adminBtn);
      }

      // Logout Button
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'nav-btn logout-btn';
      if (nav.className.includes('nav-actions')) {
        logoutBtn.className = 'nav-link-btn logout-btn';
      }
      logoutBtn.innerHTML = '🚪 Logout';
      logoutBtn.addEventListener('click', () => {
        window.auth.signOut().then(() => {
          window.location.href = 'index.html';
        });
      });
      authContainer.appendChild(logoutBtn);

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
    .nav-user-info span.nav-greeting {
      font-size: 0.82rem !important;
      font-weight: 700 !important;
      color: #1E1B4B !important;
      background: rgba(108, 99, 255, 0.08) !important;
      padding: 0.42rem 0.85rem !important;
      border-radius: 20px !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      white-space: nowrap !important;
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

    /* Standardised button heights & paddings */
    header.nav .nav-btn, header.nav .nav-user-info .nav-btn {
      padding: 0.5rem 1.1rem !important;
      border-radius: 999px !important;
      border: 1px solid rgba(108, 99, 255, 0.3) !important;
      height: 38px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-sizing: border-box !important;
      font-size: 0.82rem !important;
      font-weight: 700 !important;
    }
    header.nav .nav-user-info .logout-btn {
      background: rgba(255, 107, 107, 0.12) !important;
      color: #CC4444 !important;
      border: 1px solid rgba(255, 107, 107, 0.35) !important;
    }

    nav.navbar .nav-btn, nav.navbar .nav-user-info .nav-btn {
      padding: 0.42rem 0.95rem !important;
      border-radius: 40px !important;
      border: none !important;
      height: 34px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-sizing: border-box !important;
      font-size: 0.82rem !important;
      font-weight: 600 !important;
    }
    nav.navbar .nav-user-info .logout-btn {
      background: rgba(255, 107, 107, 0.12) !important;
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
  const navContainer = header.querySelector('.nav-links, .nav-actions, #navLinks, #nav-links');
  
  if (!hamburger && navContainer) {
    hamburger = document.createElement('button');
    hamburger.className = 'hamburger';
    hamburger.setAttribute('aria-label', 'Toggle Menu');
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    header.appendChild(hamburger);
    
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      navContainer.classList.toggle('open');
      hamburger.classList.toggle('active');
    });
  } else if (hamburger && navContainer) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navContainer.classList.toggle('open');
    });
  }

  if (navContainer) {
    document.addEventListener('click', (e) => {
      if (!header.contains(e.target)) {
        navContainer.classList.remove('open');
        if (hamburger) hamburger.classList.remove('active');
      }
    });

    navContainer.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navContainer.classList.remove('open');
        if (hamburger) hamburger.classList.remove('active');
      });
    });
  }
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

