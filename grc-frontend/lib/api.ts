const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"

/**
 * A centralized fetch wrapper that automatically attaches the base URL
 * and the user's authorization token to every request.
 */
export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  // 1. Get the token from storage
  const token = typeof window !== "undefined" 
    ? localStorage.getItem("grc_token") || sessionStorage.getItem("grc_token") 
    : null

  // 2. Set up headers, merging any custom headers passed in
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  }

  // 3. Attach the token if it exists
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Token ${token}`
  }

  // 4. Construct the full URL (ensuring no double slashes)
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint
  const url = `${API_BASE_URL}/${cleanEndpoint}`

  // 5. Execute the fetch
  const response = await fetch(url, {
    ...options,
    headers,
  })

  // 6. Global 401 Unauthorized handling
  if (response.status === 401 && typeof window !== "undefined") {
    // If the token expires or is invalid, clear storage and force a login
    localStorage.removeItem("grc_token")
    sessionStorage.removeItem("grc_token")
    window.location.reload()
  }

  return response
}