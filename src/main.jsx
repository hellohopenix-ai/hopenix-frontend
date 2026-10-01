import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "./AuthContext.jsx";
import ProtectedRoute from "./ProtectedRoute.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.jsx";
import CompleteProfilePage from "./pages/CompleteProfilePage.jsx";
import PendingApprovalPage from "./pages/PendingApprovalPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ContactPage from "./pages/ContactPage.jsx";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage.jsx";
import TermsOfServicePage from "./pages/TermsOfServicePage.jsx";
import ClientPortal from "./pages/ClientPortal.jsx";
import ClientIntakeForm from "./pages/ClientIntakeForm.jsx";
import ZipFilesPage from "./pages/ZipFilesPage.jsx";
import "./brand.js"; // fetches the company logo (Settings -> General) for every page
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
          {/* "/" is always the landing page - this is what fixes the
              "login page opens first" issue. The old setup nested
              LandingPage under <App/>, but App.jsx never rendered an
              <Outlet/>, so LandingPage never actually showed up - App.jsx's
              own logic (always defaulting to LoginPage) won instead. */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Reached from the "Forgot password?" link on LoginPage.
              Self-contained multi-step flow (email -> code -> new
              password), matching Login/Register's own dark auth-shell
              styling. Not wrapped in ProtectedRoute since the person
              isn't logged in yet at this point. */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />

          {/* Shown right after signup, before the approval queue.
              Collects personal info, address, education/experience,
              work type & skills, ID card (front + back), and bank
              details. Not wrapped in ProtectedRoute for the same reason
              as /pending-approval below: the page guards itself (no
              user -> /login, already approved -> /dashboard, already
              submitted -> /pending-approval), so wrapping it would risk
              a redirect loop instead of preventing one. */}
          <Route path="/complete-profile" element={<CompleteProfilePage />} />

          {/* Shown to a logged-in user whose account is pending admin
              approval (or was rejected). Not wrapped in ProtectedRoute
              because ProtectedRoute itself redirects pending/rejected
              users here - that would create a redirect loop. The page
              handles "no user" and "already approved" redirects itself. */}
          <Route path="/pending-approval" element={<PendingApprovalPage />} />

          {/* These three were missing - the landing/contact/legal pages
              call navigate("/contact") etc, but with no matching <Route>
              React Router had nothing to render at those paths, which is
              why they showed up blank. */}
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/terms-of-service" element={<TermsOfServicePage />} />

          {/* Client-facing portal - separate login (Client ID + email + portal password)
              from the admin auth flow, so it's intentionally outside
              ProtectedRoute. It manages its own session in
              localStorage and only reads the clientspage_clients_v1
              data the admin panel writes - never edits it. */}
          <Route path="/client-portal" element={<ClientPortal />} />

          {/* Public "New Project Request" intake form — a prospect fills
              this in themselves (project details + 30% advance payment
              screenshot) with no login. Submissions land in ClientsPage's
              "Requests" panel for an admin to Approve/Reject. Intentionally
              outside ProtectedRoute for the same reason /client-portal is:
              nobody filling it out has an account yet. */}
          <Route path="/client-request" element={<ClientIntakeForm />} />

          {/* Dashboard now requires being logged in AND approved. If
              there's no user, ProtectedRoute bounces to /login; if the
              user is pending/rejected, it bounces to /pending-approval. */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Users & Roles used to be a separate route rendering its own
              standalone page with no shared Sidebar/Topbar. It's now the
              "Users" tab inside Dashboard itself (same pattern as
              Messages), so there's no separate route for it anymore —
              clicking "Users" in the sidebar just switches the active tab. */}

          {/* Zip Files also lives as a "Zip Files" tab inside Dashboard
              (same pattern as Users/Projects/Tasks above) for normal,
              day-to-day sidebar navigation. This extra top-level route
              is a direct-link shortcut to the exact same page — e.g. for
              bookmarking or sharing a link straight to it — so it's kept
              behind ProtectedRoute (must be logged in) the same way
              /dashboard is. ZipFilesPage still runs its own admin-only
              check and its own separate password gate on top of that,
              so reaching this URL doesn't bypass either protection. It
              renders standalone here (no Sidebar/Topbar), the same way
              /client-portal does above. */}
          <Route
            path="/zip-files"
            element={
              <ProtectedRoute>
                <ZipFilesPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>
);