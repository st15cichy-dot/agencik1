import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.9.1",
  description: "Autonomous paper research with health scoring, hourly watchdog alerts and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
