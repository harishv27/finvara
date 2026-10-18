import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import Landing from "./pages/Landing";
import { Login, Signup } from "./pages/AuthPages";

const Onboarding = lazy(() => import("./pages/Onboarding"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Budget = lazy(() => import("./pages/Budget"));
const Calculators = lazy(() => import("./pages/Calculators"));
const Planner = lazy(() => import("./pages/Planner"));
const Will = lazy(() => import("./pages/Will"));
const Funds = lazy(() => import("./pages/Funds"));
const Stocks = lazy(() => import("./pages/Stocks"));
const Chat = lazy(() => import("./pages/Chat"));
const Profile = lazy(() => import("./pages/Profile"));
const Admin = lazy(() => import("./pages/admin/Admin"));

function RequireAuth() {
  const { user, onboarded, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center"><PageLoader /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (!onboarded && user.role !== "admin" && loc.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

/** Public calculators: guests get a standalone page, signed-in users are sent to the in-app version. */
function PublicCalculators() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center"><PageLoader /></div>;
  return user ? <Navigate to="/tools" replace /> : <Calculators standalone />;
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center"><PageLoader /></div>;
  return user ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><PageLoader /></div>}>
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
        </Route>
        <Route path="/calculators" element={<PublicCalculators />} />
        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/budget" element={<Budget />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/tools" element={<Calculators />} />
            <Route path="/will" element={<Will />} />
            <Route path="/funds" element={<Funds />} />
            <Route path="/stocks" element={<Stocks />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/profile" element={<Profile />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<Admin />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
