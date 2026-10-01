import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.11",
  description: "Autonomous paper research with shadow strategy governance, portfolio intelligence and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
