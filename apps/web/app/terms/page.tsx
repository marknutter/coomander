import Link from "next/link";
import { Sprout } from "lucide-react";

export const metadata = {
  title: "Terms of Service",
  description: "Terms governing your use of the Coomander service.",
};

/**
 * Comprehensive Terms of Service template.
 *
 * CUSTOMIZATION: Replace all YOUR_COMPANY, YOUR_DOMAIN, YOUR_EMAIL,
 * YOUR_STATE, and YOUR_COUNTRY placeholders with your actual values.
 */
export default function TermsOfService() {
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
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
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
            <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              By accessing or using the service (&quot;the Service&quot;) at{" "}
              <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_DOMAIN</span>,
              you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not
              agree to these Terms, do not use the Service. These Terms apply to all
              visitors, users, and subscribers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_COMPANY</span>{" "}
              provides a web application platform that includes user authentication,
              data management, and subscription-based features. The Service is offered
              on both free and paid tiers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Account Registration</h2>
            <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                You must provide a valid email address and create a password (or use a
                supported OAuth provider) to use the Service. You are responsible for:
              </p>
              <ul className="list-disc list-inside space-y-2">
                <li>Maintaining the confidentiality of your account credentials</li>
                <li>All activity that occurs under your account</li>
                <li>Notifying us immediately of any unauthorized access</li>
              </ul>
              <p>You must be at least 13 years of age (or 16 in the EU) to use the Service.</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Free and Pro Plans</h2>
            <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Free Plan:</strong>
                <p className="mt-1">Access to core features at no cost. Free plan features may be modified at any time.</p>
              </div>
              <div>
                <strong className="text-gray-800 dark:text-gray-100">Pro Plan:</strong>
                <p className="mt-1">
                  Access to all features for a recurring subscription fee. We reserve the
                  right to adjust pricing with 30 days&apos; written notice to existing
                  subscribers. Current pricing is displayed on our website.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Payments, Billing, and Cancellation</h2>
            <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                Payments are processed by Stripe. By subscribing, you authorize us to
                charge your payment method on a recurring basis.
              </p>
              <ul className="list-disc list-inside space-y-2">
                <li>
                  <strong className="text-gray-800 dark:text-gray-100">Cancellation:</strong> You may cancel at any time through the billing
                  portal in your account settings. Cancellation takes effect at the end
                  of your current billing period.
                </li>
                <li>
                  <strong className="text-gray-800 dark:text-gray-100">Refunds:</strong> No partial refunds are issued for unused time in a
                  billing period. Refund requests for exceptional circumstances may be
                  submitted to{" "}
                  <a href="mailto:YOUR_EMAIL" className="text-primary underline">
                    <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_EMAIL</span>
                  </a>.
                </li>
                <li>
                  <strong className="text-gray-800 dark:text-gray-100">Failed payments:</strong> If a payment fails, we may suspend access to
                  paid features until the payment issue is resolved.
                </li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Acceptable Use</h2>
            <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>You agree not to use the Service to:</p>
              <ul className="list-disc list-inside space-y-2">
                <li>Violate any applicable local, state, national, or international law</li>
                <li>Attempt to gain unauthorized access to our systems or other users&apos; accounts</li>
                <li>Upload malicious code, viruses, or harmful content</li>
                <li>Scrape, reverse-engineer, or interfere with the Service</li>
                <li>Harass, abuse, or harm other users</li>
                <li>Send unsolicited communications (spam)</li>
              </ul>
              <p>
                We reserve the right to suspend or terminate accounts that violate these
                terms, with or without notice depending on severity.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Intellectual Property</h2>
            <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                The service name, logo, design, and all associated proprietary content
                are the property of{" "}
                <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_COMPANY</span>.
              </p>
              <p>
                You retain full ownership of the data and content you create within the
                Service. By using the Service, you grant us a limited license to process
                your data solely for the purpose of providing the Service.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Account Termination</h2>
            <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                You may delete your account at any time through the account settings
                page. Upon deletion:
              </p>
              <ul className="list-disc list-inside space-y-2">
                <li>Your personal data will be deleted within 30 days</li>
                <li>Any active subscription will be cancelled</li>
                <li>Your data cannot be recovered after deletion</li>
              </ul>
              <p>
                We may terminate or suspend your account if you violate these Terms or
                for any other reason at our sole discretion, with reasonable notice where
                possible.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Disclaimer of Warranties</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranty of
              any kind, express or implied, including but not limited to warranties of
              merchantability, fitness for a particular purpose, and non-infringement.
              We do not guarantee that the Service will be uninterrupted, error-free, or
              completely secure. Use of the Service is at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Limitation of Liability</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              To the maximum extent permitted by law,{" "}
              <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_COMPANY</span>{" "}
              shall not be liable for any indirect, incidental, special, consequential,
              or punitive damages arising out of your use of the Service. Our total
              aggregate liability for any claim shall not exceed the amount you paid us
              in the 12 months preceding the claim, or $100, whichever is greater.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Dispute Resolution</h2>
            <div className="space-y-3 text-gray-600 dark:text-gray-300 leading-relaxed">
              <p>
                Any disputes arising from these Terms or the Service shall first be
                attempted to be resolved through good-faith negotiation. If a resolution
                cannot be reached within 30 days, the dispute shall be resolved through
                binding arbitration in accordance with the rules of the American
                Arbitration Association.
              </p>
              <p>
                You agree to resolve disputes on an individual basis and waive any right
                to participate in a class action.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Governing Law</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              These Terms are governed by the laws of the State of{" "}
              <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_STATE</span>,{" "}
              <span className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">YOUR_COUNTRY</span>,
              without regard to conflict of law principles.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">13. Changes to Terms</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              We may update these Terms from time to time. We will notify you of
              material changes by email or by posting a prominent notice on the site at
              least 30 days before the changes take effect. Continued use of the Service
              after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">14. Contact</h2>
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              Questions about these Terms? Contact us at{" "}
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
          <Link href="/privacy-policy" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
