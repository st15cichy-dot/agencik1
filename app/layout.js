import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.7",
  description: "Autonomous research, persistent simulated paper portfolio and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
