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
  '/register.html'
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
      authContainer.style.cssText = 'display: inline-flex; align-items: center; gap: 0.5rem; margin-left: 0.75rem; flex-wrap: wrap;';

      // Greeting badge
      const greeting = document.createElement('span');
      greeting.style.cssText = 'font-size: 0.82rem; font-weight: 700; color: var(--text, #1E1B4B); background: rgba(108, 99, 255, 0.08); padding: 0.3rem 0.75rem; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px;';
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
        adminBtn.className = 'nav-btn';
        adminBtn.style.borderColor = 'var(--gold, #F5A623)';
        adminBtn.style.color = 'var(--gold-dk, #C17D0A)';
        adminBtn.style.background = 'rgba(245, 166, 35, 0.08)';
        adminBtn.innerHTML = '🔑 Admin';
        if (nav.className.includes('nav-actions')) {
          adminBtn.className = 'nav-link-btn';
        }
        authContainer.appendChild(adminBtn);
      }

      // Logout Button
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'nav-btn';
      logoutBtn.style.cssText = 'background: rgba(255, 107, 107, 0.12); color: var(--coral-dk, #CC4444); border: none; padding: 0.38rem 0.9rem; border-radius: 40px; font-weight: 600; font-size: 0.82rem; cursor: pointer; transition: 0.18s;';
      if (nav.className.includes('nav-actions')) {
        logoutBtn.className = 'nav-link-btn';
        logoutBtn.style.cssText = 'background: rgba(255, 107, 107, 0.12); color: var(--coral-dk, #CC4444); font-family: inherit; font-size: 0.78rem; padding: 0.35rem 0.75rem; border-radius: 40px; border: none; cursor: pointer;';
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

    // Prepare merged badges (Firestore structure uses arrays for badges as per instruction)
    // users/{userId}/badges: ["Beginner", "Explorer"]
    // Let's map L1 -> "Seedling Badge", L2 -> "Logic Spark Badge", etc.
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

    // Merge scores. Format: scores: { level1: 90, level2: 75 } as requested
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

    // Determine current level based on completed quizzes (highest level passed + 1, capped at 6)
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
    // Log as backup if toast element does not exist yet
    console.log(`[Toast Notification]: ${msg}`);
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
});
