import Link from "next/link";
import { Sprout } from "lucide-react";

export const metadata = {
  title: "Privacy Policy",
  description: "How Coomander collects, uses, and protects your data.",
};

/**
 * Comprehensive Privacy Policy template.
 *
 * CUSTOMIZATION: Replace all YOUR_COMPANY, YOUR_DOMAIN, YOUR_EMAIL,
 * and YOUR_DPO_EMAIL placeholders with your actual values.
 */
export default function PrivacyPolicy() {
  const updated = "February 22, 2026";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <Sprout className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
            <span className="font-bold text-gray-900 dark:text-gray-100">Coomander</span>
          </Link>
          <Link
            href="/auth?tab=signup"
            className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Get Started Free
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
          Last updated: {updated}
        </p>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-200 mb-12">
          <strong>Template notice:</strong> This is a starting template.
          Replace all <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">YOUR_*</code> placeholders
          with your actual company information before going live. Consider
          having a lawyer review the final version for your jurisdiction.
        </div>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Who We Are</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_COMPANY</span> (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the service available at{" "}
              <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_DOMAIN</span>.
              This Privacy Policy explains how we collect, use, disclose, and protect
              information about you when you use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>
            <div className="space-y-4 text-gray-600 dark:text-gray-300 leading-relaxed">
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Account information:</strong>
                <p className="mt-1">
                  When you sign up, we collect your email address and a securely hashed
                  version of your password. If you sign in via Google or GitHub OAuth, we
                  receive your name, email address, and profile picture from the provider.
                  We never store your password in plain text.
                </p>
              </div>
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Usage data:</strong>
                <p className="mt-1">
                  Information you enter or actions you take while using the service,
                  including features accessed, pages viewed, and settings configured.
                </p>
              </div>
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Payment information:</strong>
                <p className="mt-1">
                  If you subscribe to a paid plan, payment is processed by Stripe. We
                  store your Stripe customer ID and subscription status. We never see,
                  process, or store your full card number or banking details.
                </p>
              </div>
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Device and log data:</strong>
                <p className="mt-1">
                  We may collect your IP address, browser type, operating system, and
                  referring URL for security monitoring and service improvement.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-300 leading-relaxed">
              <li>To provide, operate, and maintain the service</li>
              <li>To authenticate your identity and secure your account</li>
              <li>To process subscription payments and manage billing</li>
              <li>To send transactional emails (verification, password reset, billing)</li>
              <li>To improve, debug, and optimize the service</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Cookies and Tracking</h2>
            <div className="space-y-4 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>We use the following types of cookies:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800">
                      <th className="text-left px-4 py-2 font-semibold border-b border-gray-200 dark:border-gray-700">Type</th>
                      <th className="text-left px-4 py-2 font-semibold border-b border-gray-200 dark:border-gray-700">Purpose</th>
                      <th className="text-left px-4 py-2 font-semibold border-b border-gray-200 dark:border-gray-700">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">Essential</td>
                      <td className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">Authentication, session management, CSRF protection</td>
                      <td className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">Session</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">Preferences</td>
                      <td className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">Theme preference, cookie consent choice</td>
                      <td className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">1 year</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2">Analytics</td>
                      <td className="px-4 py-2">Usage patterns and performance monitoring (if enabled)</td>
                      <td className="px-4 py-2">1 year</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                You can manage your cookie preferences through the cookie consent banner
                or your browser settings. Disabling essential cookies may prevent you
                from using the service.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Third-Party Services</h2>
            <div className="space-y-4 text-gray-600 dark:text-gray-300 leading-relaxed">
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Stripe</strong> — Payment processing.{" "}
                <a href="https://stripe.com/privacy" className="text-primary underline" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
              </div>
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Resend</strong> — Transactional email delivery.{" "}
                <a href="https://resend.com/legal/privacy-policy" className="text-primary underline" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
              </div>
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Google</strong> — OAuth authentication (if you sign in with Google).{" "}
                <a href="https://policies.google.com/privacy" className="text-primary underline" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
              </div>
              <div>
                <strong className="text-gray-800 dark:text-gray-100">GitHub</strong> — OAuth authentication (if you sign in with GitHub).{" "}
                <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" className="text-primary underline" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data Retention</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              We retain your data for as long as your account is active. If you delete
              your account, we will delete your personal data within 30 days. Some data
              may be retained longer as required by law or for legitimate business
              purposes such as fraud prevention and financial record-keeping.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Data Security</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              We use industry-standard security practices including encrypted connections
              (TLS/HTTPS), hashed passwords (bcrypt), secure token-based authentication,
              and two-factor authentication. However, no system is completely secure. We
              encourage you to use a strong, unique password and enable 2FA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Your Rights (GDPR / CCPA)</h2>
            <div className="space-y-4 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                Depending on your location, you may have the following rights regarding
                your personal data:
              </p>
              <ul className="list-disc list-inside space-y-2">
                <li><strong className="text-gray-800 dark:text-gray-100">Access</strong> — Request a copy of the personal data we hold about you</li>
                <li><strong className="text-gray-800 dark:text-gray-100">Rectification</strong> — Request correction of inaccurate data</li>
                <li><strong className="text-gray-800 dark:text-gray-100">Erasure</strong> — Request deletion of your personal data</li>
                <li><strong className="text-gray-800 dark:text-gray-100">Portability</strong> — Request your data in a machine-readable format</li>
                <li><strong className="text-gray-800 dark:text-gray-100">Objection</strong> — Object to processing of your data</li>
                <li><strong className="text-gray-800 dark:text-gray-100">Restriction</strong> — Request limitation of processing</li>
                <li><strong className="text-gray-800 dark:text-gray-100">Non-discrimination</strong> — We will not discriminate against you for exercising your rights</li>
              </ul>
              <p>
                To exercise these rights, use the data export feature in Settings or
                contact us at{" "}
                <a href="mailto:YOUR_EMAIL" className="text-primary underline">
                  <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_EMAIL</span>
                </a>
                . We will respond within 30 days.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. International Data Transfers</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              Your data may be transferred to and processed in countries other than your
              own. We ensure appropriate safeguards are in place, including standard
              contractual clauses where required.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Children&apos;s Privacy</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              This service is not intended for use by children under the age of 13 (or
              16 in the EU). We do not knowingly collect personal information from
              children.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Changes to This Policy</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of
              significant changes by email or by posting a notice on the site. Your
              continued use of the service after changes take effect constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Contact Us</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              If you have questions about this Privacy Policy or wish to exercise your
              data rights, please contact us at{" "}
              <a href="mailto:YOUR_EMAIL" className="text-primary underline">
                <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_EMAIL</span>
              </a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 text-center text-gray-400 dark:text-gray-500 text-sm mt-16">
        <div className="flex items-center justify-center gap-6">
          <Link href="/" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Home
          </Link>
          <Link href="/terms" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Terms of Service
          </Link>
        </div>
      </footer>
    </div>
  );
}
