import { formatMYR } from "../domain/money";
import { usePrivacy } from "../app/providers/PrivacyProvider";

interface AmountProps {
  value: number;
  className?: string;
}

export function Amount({ value, className }: AmountProps) {
  const { privacyMode } = usePrivacy();
  return <span className={className}>{formatMYR(value, privacyMode)}</span>;
}
