import React from "react";

interface TestProps {
  userBalance: number;
}

export const TestComponent: React.FC<TestProps> = ({
  userBalance,
}) => {
  return <div>Balance: {userBalance}</div>;
};