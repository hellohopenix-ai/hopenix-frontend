import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";

/* ===========================================================================
   ProtectedRoute - guards any route that requires a logged-in, approved
   user.

   - Still checking the saved token (authLoading === true) -> render nothing
     yet (avoids bouncing to /login on every page reload before the /me/
     call has had a chance to come back).
   - No user at all              -> bounce to /login
   - user.status === "pending"   -> bounce to /pending-approval
   - user.status === "rejected"  -> bounce to /pending-approval (it shows
     the "declined" message when it sees a rejected user)
   - user.status === "approved"  -> render the page

   Optionally restrict a route to specific roles, e.g. an admin-only
   Settings/Users page:

     <ProtectedRoute allowedRoles={["admin"]}>
       <UsersApprovalPage />
     </ProtectedRoute>
   =========================================================================== */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, authLoading } = useAuth();

  // Saved token is still being verified against the backend (GET /me/) —
  // wait for that to finish instead of redirecting prematurely. Every
  // page reload starts with user === null for a brief moment even when
  // the token IS valid, so checking user alone here caused a false
  // bounce to /login on every refresh.
  if (authLoading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.status === "pending" || user.status === "rejected") {
    return <Navigate to="/pending-approval" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}