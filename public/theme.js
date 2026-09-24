/**
 * Infinite Trading - Universal Theme Engine (Light / Dark Mode)
 * Defaults to 'dark' (Dark Slate & Electric Mint).
 * Supports instant load with zero flash (FOUC) and localStorage persistence.
 */
(function () {
  const THEME_KEY = 'infinite_theme';

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return 'dark';
  }

  function updateThemeUI(theme) {
    const isDark = theme === 'dark';

    // Update all logo instances
    const logos = document.querySelectorAll(
      '.land-brand-logo, .hero-main-img, .top-brand-logo, .brand-logo, .dash-footer-logo, .auth-logo-interactive img'
    );
    logos.forEach(img => {
      if (isDark) {
        if (!img.src.includes('site-logo.png')) {
          img.src = '/images/site-logo.png?v=20260924gold';
        }
      } else {
        if (!img.src.includes('site-logo-original.png')) {
          img.src = '/images/site-logo-original.png?v=20260924light';
        }
      }
    });

    // Update all theme toggle buttons
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      const icon = btn.querySelector('.theme-toggle-icon');
      const text = btn.querySelector('.theme-toggle-text');
      if (icon) icon.innerHTML = isDark ? '☀️' : '🌙';
      if (text) text.textContent = isDark ? 'Light' : 'Dark';
    });
  }

  // Instant apply to document root before render
  const initialTheme = getPreferredTheme();
  document.documentElement.setAttribute('data-theme', initialTheme);

  // Global toggle function
  window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
    document.documentElement.setAttribute('data-theme', next);
    if (document.body) {
      document.body.setAttribute('data-theme', next);
    }
    updateThemeUI(next);
  };

  // Sync on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const theme = document.documentElement.getAttribute('data-theme') || 'dark';
      if (document.body) document.body.setAttribute('data-theme', theme);
      updateThemeUI(theme);

      document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          window.toggleTheme();
        });
      });
    });
  } else {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    if (document.body) document.body.setAttribute('data-theme', theme);
    updateThemeUI(theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.toggleTheme();
      });
    });
  }
})();
