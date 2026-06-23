import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { useBluehourData } from "./providers/BluehourDataProvider";

const OverviewPage = lazy(() => import("../features/dashboard/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const TransactionsPage = lazy(() => import("../features/transactions/TransactionsPage").then((module) => ({ default: module.TransactionsPage })));
const BudgetsPage = lazy(() => import("../features/budgets/BudgetsPage").then((module) => ({ default: module.BudgetsPage })));
const PlanPage = lazy(() => import("../features/plan/PlanPage").then((module) => ({ default: module.PlanPage })));
const CoachPage = lazy(() => import("../features/coach/CoachPage").then((module) => ({ default: module.CoachPage })));
const SubscriptionsPage = lazy(() => import("../features/subscriptions/SubscriptionsPage").then((module) => ({ default: module.SubscriptionsPage })));
const NetWorthPage = lazy(() => import("../features/net-worth/NetWorthPage").then((module) => ({ default: module.NetWorthPage })));
const ReviewPage = lazy(() => import("../features/reviews/ReviewPage").then((module) => ({ default: module.ReviewPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const WelcomePage = lazy(() => import("../features/onboarding/WelcomePage").then((module) => ({ default: module.WelcomePage })));
const OnboardingPage = lazy(() => import("../features/onboarding/OnboardingPage").then((module) => ({ default: module.OnboardingPage })));
const RecoveryStatePage = lazy(() => import("../features/recovery/RecoveryStatePage").then((module) => ({ default: module.RecoveryStatePage })));
const ContinueWithGooglePage = lazy(() =>
  import("../features/recovery/ContinueExistingSheetPage").then((module) => ({ default: module.ContinueWithGooglePage }))
);

export function App() {
  const { applicationState } = useBluehourData();

  if (applicationState === "welcome") {
    return <Suspense fallback={<PageFallback />}><WelcomePage /></Suspense>;
  }

  if (applicationState === "connect_existing") {
    return <Suspense fallback={<PageFallback />}><ContinueWithGooglePage /></Suspense>;
  }

  if (applicationState === "setup" || applicationState === "ready_for_salary") {
    return <Suspense fallback={<PageFallback />}><OnboardingPage /></Suspense>;
  }

  if (applicationState === "read_only_recovery") {
    return <Suspense fallback={<PageFallback />}><RecoveryStatePage /></Suspense>;
  }

  if (applicationState === "sync_conflict") {
    return (
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<SettingsPage />} />
        </Route>
      </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="coach" element={<CoachPage />} />
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="net-worth" element={<NetWorthPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

function PageFallback() {
  return <div className="loading-state">Opening Bluehour...</div>;
}
