import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.10",
  description: "Autonomous paper research with portfolio intelligence, health monitoring and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
