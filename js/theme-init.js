/* Applies the saved/system theme before first paint to avoid a flash. */
(function () {
  var theme;
  try { theme = localStorage.getItem('bannu-theme'); } catch (e) { /* storage unavailable */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
