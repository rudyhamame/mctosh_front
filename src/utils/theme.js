export const THEME_STORAGE_KEY = "mctosh_theme";
export const DEFAULT_THEME = "light";

export const normalizeThemeId = (themeId) => (
  ["original", "light", "dark"].includes(themeId) ? themeId : DEFAULT_THEME
);

export const readStoredTheme = () => {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  return normalizeThemeId(localStorage.getItem(THEME_STORAGE_KEY));
};

export const applyTheme = (themeId, { persist = true } = {}) => {
  if (typeof document === "undefined") return normalizeThemeId(themeId);
  const nextTheme = normalizeThemeId(themeId);

  document.documentElement.classList.remove("theme-light", "theme-dark");
  if (nextTheme === "light") document.documentElement.classList.add("theme-light");
  if (nextTheme === "dark") document.documentElement.classList.add("theme-dark");

  if (persist && typeof localStorage !== "undefined") {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }
  return nextTheme;
};

export const applyStoredTheme = () => applyTheme(readStoredTheme(), { persist: false });
