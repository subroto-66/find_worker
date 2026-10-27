import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/providers/AuthProvider";




export const metadata: Metadata = {
  title: "Train the Next Generation of AI as a Freelancer | Outlier AI",
  description:
    "What is Outlier? A platform for building AI with expert human input. Discover Outlier AI, join a community for freelancers, and shape the next generation of AI.",
  keywords:
    "Outlier AI, Scale AI, freelance AI training, RLHF, AI evaluator, work from home, remote coding, freelance mathematics",
  openGraph: {
    title: "Train the Next Generation of AI as a Freelancer | Outlier AI",
    description:
      "What is Outlier? A platform for building AI with expert human input. Discover Outlier AI, join a community for freelancers, and shape the next generation of AI.",
    url: "https://outlier.ai/",
    siteName: "Outlier AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Train the Next Generation of AI as a Freelancer | Outlier AI",
    description:
      "What is Outlier? A platform for building AI with expert human input. Discover Outlier AI, join a community for freelancers, and shape the next generation of AI.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Fragment+Mono&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          href="/logo.png"
        />
      </head>
      <body className="bg-white text-slate-900 antialiased selection:bg-indigo-100 selection:text-indigo-900">
        <AuthProvider>

          {children}

        </AuthProvider>
        
      </body>
    </html>
  );
}
