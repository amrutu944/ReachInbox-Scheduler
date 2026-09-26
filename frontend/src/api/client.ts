import axios from "axios";

// Production builds are served by the backend itself, so API calls go to the same origin.
export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:4000");

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});
