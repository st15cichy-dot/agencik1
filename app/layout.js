import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.8",
  description: "Autonomous paper research with regression gates, resilient market data and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
