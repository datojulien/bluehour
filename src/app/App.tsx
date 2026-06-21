import { Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { OverviewPage } from "../features/dashboard/OverviewPage";
import { TransactionsPage } from "../features/transactions/TransactionsPage";
import { BudgetsPage } from "../features/budgets/BudgetsPage";
import { PlanPage } from "../features/plan/PlanPage";
import { SubscriptionsPage } from "../features/subscriptions/SubscriptionsPage";
import { NetWorthPage } from "../features/net-worth/NetWorthPage";
import { ReviewPage } from "../features/reviews/ReviewPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useBluehourData } from "./providers/BluehourDataProvider";
import { WelcomePage } from "../features/onboarding/WelcomePage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";

export function App() {
  const { applicationState } = useBluehourData();

  if (applicationState === "welcome") {
    return <WelcomePage />;
  }

  if (applicationState === "setup" || applicationState === "ready_for_salary") {
    return <OnboardingPage />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="net-worth" element={<NetWorthPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
