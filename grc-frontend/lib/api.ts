export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const headers: HeadersInit = {
    ...options.headers,
  };

  // Only set application/json if the body is not FormData
  if (!(options.body instanceof FormData)) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  // Inject CSRF token if available
  const csrfToken = getCookie("csrftoken");
  if (csrfToken) {
    (headers as Record<string, string>)["X-CSRFToken"] = csrfToken;
  }

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint
  const url = `${API_BASE_URL}/${cleanEndpoint}`

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include", // Instructs browser to send HttpOnly cookies
  })

  // Global 401 Unauthorized handling
  if (response.status === 401 && typeof window !== "undefined") {
    // Selectively clear session credentials, preserving persistent device settings like onboarding status
    const authKeys = ["grc_username", "grc_role", "grc_avatar", "grc_token"]
    authKeys.forEach((key) => {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    })
    
    // Safely redirect to login without looping if already on the root page
    if (window.location.pathname !== "/") {
      window.location.href = "/"
    }
  }

  return response
}
