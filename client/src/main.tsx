import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PostHogProvider } from 'posthog-js/react';
import App from "./App";
import "./index.css";
import { POSTHOG_KEY, posthogOptions } from "./lib/posthog";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {POSTHOG_KEY ? (
      <PostHogProvider apiKey={POSTHOG_KEY} options={posthogOptions}>
        <App />
      </PostHogProvider>
    ) : (
      <App />
    )}
  </StrictMode>
);
