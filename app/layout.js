import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.4",
  description: "Multi-market research, strict validation, benchmark comparison and paper candidates.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
