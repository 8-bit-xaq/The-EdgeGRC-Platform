export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
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
    // Aggressively clear all state
    localStorage.clear()
    sessionStorage.clear()
    
    // Safely redirect to login without looping if already on the root page
    if (window.location.pathname !== "/") {
      window.location.href = "/"
    }
  }

  return response
}