import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.20",
  description: "Autonomous paper research with shadow execution-quality simulation, market expansion and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
