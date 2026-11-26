import {
    Routes,
    Route,
    useLocation,
    Navigate,
} from "react-router-dom";

import Navbar from "./components/Navbar";
import ProtectedRoute from "./components/ProtectedRoute";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Analyze from "./pages/Analyze";
import Report from "./pages/Report";
import History from "./pages/History";
import RankTracker from "./pages/RankTracker";
import RankDetail from "./pages/RankDetail";

import { Toaster } from "react-hot-toast";
import { useApp } from "./context/AppContext";

export default function App() {
    const { user, loading } = useApp();
    const location = useLocation();

    const hideNavbar = ["/login", "/register"].includes(
        location.pathname
    );

    // Wait until AppContext finishes checking the saved token
    if (loading) {
        return (
            <div className="min-h-screen flex justify-center items-center bg-dark-900">
                <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <>
            <Toaster />

            {!hideNavbar && <Navbar />}

            <Routes>
                {/* Public route */}
                <Route path="/" element={<Home />} />

                {/* Auth routes */}
                <Route
                    path="/login"
                    element={
                        user ? (
                            <Navigate
                                to="/dashboard"
                                replace
                            />
                        ) : (
                            <Login state="login" />
                        )
                    }
                />

                <Route
                    path="/register"
                    element={
                        user ? (
                            <Navigate
                                to="/dashboard"
                                replace
                            />
                        ) : (
                            <Login state="register" />
                        )
                    }
                />

                {/* Protected routes */}
                <Route element={<ProtectedRoute />}>
                    <Route
                        path="/dashboard"
                        element={<Dashboard />}
                    />

                    <Route
                        path="/analyze"
                        element={<Analyze />}
                    />

                    <Route
                        path="/report/:id"
                        element={<Report />}
                    />

                    <Route
                        path="/history"
                        element={<History />}
                    />

                    <Route
                        path="/rank-tracker"
                        element={<RankTracker />}
                    />

                    <Route
                        path="/rank/:id"
                        element={<RankDetail />}
                    />
                </Route>

                {/* Optional: catch unknown URLs */}
                <Route
                    path="*"
                    element={<Navigate to="/" replace />}
                />
            </Routes>
        </>
    );
}