import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAppNavigationState } from '../../app/navigation';
import styles from './InformationPage.module.css';

const projectRepository = 'https://github.com/xensenx/WebXReader';

function TermsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.proseSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function TermsOfUse() {
  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <FileText size={19} aria-hidden="true" />
        <div>
          <h2 className={styles.cardTitle}>WebXReader — Terms of Use</h2>
          <p className={styles.updated}>
            <strong>Effective date:</strong> <time dateTime="2026-11-28">November 28, 2026</time>
          </p>
        </div>
      </div>

      <div className={styles.prose}>
        <TermsSection title="1. Acceptance of Terms">
          <p>By accessing, using, or otherwise interacting with WebXReader, you acknowledge and agree to these Terms of Use.</p>
          <p>These terms govern your use of WebXReader, including its official hosted instances, associated services, and features.</p>
          <p>If you do not agree to these terms, you should discontinue your use of the application.</p>
        </TermsSection>

        <TermsSection title="2. Nature of the Application">
          <p>WebXReader is an independently maintained, open-source, local-first digital reading and library management application designed to allow users to organize, manage, and read their digital materials directly within their browsers.</p>
          <p>WebXReader is provided free of charge and does not require users to create an account or purchase a subscription to access its core functionality.</p>
          <p>WebXReader is a general-purpose software tool. It is not a publisher, bookseller, content distribution platform, or provider of copyrighted reading materials.</p>
          <p>Features, supported formats, functionality, and availability may change over time.</p>
        </TermsSection>

        <TermsSection title="3. Acceptable Use">
          <p>You agree to use WebXReader in accordance with all applicable laws and regulations.</p>
          <p>You must not use WebXReader or its associated infrastructure to:</p>
          <ul>
            <li>Engage in unlawful activities.</li>
            <li>Infringe upon the intellectual property rights of others.</li>
            <li>Distribute, reproduce, or access copyrighted materials in violation of applicable laws.</li>
            <li>Introduce malicious software or deliberately interfere with the operation, security, or availability of hosted instances.</li>
            <li>Abuse, exploit, or intentionally disrupt the infrastructure provided by WebXReader or its hosting providers.</li>
          </ul>
          <p>You are solely responsible for your use of the application and the materials you choose to import, access, or manage through it.</p>
          <p>Nothing in this section is intended to restrict rights granted under WebXReader's applicable open-source software license.</p>
        </TermsSection>

        <TermsSection title="4. Copyright and Intellectual Property">
          <p>WebXReader respects intellectual property rights and does not endorse, encourage, or support copyright infringement, piracy, or the unauthorized distribution of copyrighted materials.</p>
          <p>WebXReader does not provide a service for acquiring or distributing pirated books or other copyrighted content.</p>
          <p>Users are responsible for ensuring that they possess the necessary rights, permissions, or lawful basis to access, reproduce, import, and use their materials.</p>
          <p>WebXReader does not routinely inspect, monitor, or verify the copyright status of materials stored within users' local libraries.</p>
          <p>The ability of WebXReader to open or process a particular file does not constitute approval, authorization, or endorsement of its contents or means of acquisition.</p>
          <p>Users retain their respective rights in their original notes, annotations, and other content created through the application. Importing materials into WebXReader does not transfer ownership of those materials to WebXReader or its maintainers.</p>
        </TermsSection>

        <TermsSection title="5. Local Data Storage">
          <p>WebXReader follows a local-first architecture. Personal library data, imported files, reading progress, bookmarks, notes, preferences, statistics, and other associated information may be stored locally within your browser or device, depending on the features available.</p>
          <p>WebXReader does not guarantee the permanent retention, integrity, accessibility, or recoverability of locally stored data.</p>
          <p>Local data may be lost, corrupted, deleted, or rendered inaccessible due to circumstances including, but not limited to:</p>
          <ul>
            <li>Clearing browser data, cookies, or site storage.</li>
            <li>Browser-imposed storage quotas or automatic storage eviction.</li>
            <li>Browser updates, resets, or uninstallation.</li>
            <li>Changes to browser profiles or privacy settings.</li>
            <li>Operating system failures or updates.</li>
            <li>Hardware failure, device loss, or physical damage.</li>
            <li>Software defects, database corruption, or unexpected application behavior.</li>
            <li>Insufficient available storage.</li>
            <li>Changes to hosting domains or application infrastructure.</li>
            <li>Actions performed by the user or third-party software.</li>
          </ul>
          <p>Users acknowledge that browser-based storage is not a substitute for an independent and reliable backup system.</p>
        </TermsSection>

        <TermsSection title="6. Backup and Data Recovery">
          <p>Users are responsible for maintaining independent backups of their important files, personal notes, library information, and other data.</p>
          <p>Where backup, export, import, or restoration features are available, they are provided as convenience mechanisms and are not guaranteed to preserve or recover all data under every circumstance.</p>
          <p>Users are encouraged to verify the integrity and completeness of their backups periodically and before performing potentially destructive operations.</p>
          <p>WebXReader and its maintainers do not guarantee that lost, deleted, corrupted, or inaccessible data can be recovered.</p>
          <p>To the maximum extent permitted by applicable law, WebXReader and its maintainers shall not be liable for losses resulting from the absence, failure, corruption, or inadequacy of user backups.</p>
        </TermsSection>

        <TermsSection title="7. Independent Hosted Instances and Deployment Mirrors">
          <p>WebXReader may be made available through multiple independently hosted websites, domains, deployment mirrors, and self-hosted instances.</p>
          <p>Each hosted instance may maintain its own independent browser storage environment.</p>
          <p>Unless explicitly stated otherwise, library contents, reading progress, bookmarks, notes, preferences, statistics, achievements, and other locally stored information are not automatically shared or synchronized between these instances.</p>
          <p>Accessing WebXReader through a different domain, browser, browser profile, or device may therefore result in a separate or empty library.</p>
          <p>Users are responsible for understanding which instance they are using and for transferring or backing up their data where appropriate.</p>
          <p>WebXReader does not guarantee the continued availability of any particular domain, deployment mirror, hosting provider, or self-hosted configuration.</p>
        </TermsSection>

        <TermsSection title="8. Privacy and Third-Party Services">
          <p>
            WebXReader's handling of information is described in its separately published{' '}
            <Link to="/privacy-policy" state={getAppNavigationState('/terms-of-use')}>Privacy Policy</Link>.
          </p>
          <p>WebXReader is designed to operate without user accounts, behavioral tracking, or the routine collection of personal library contents by its maintainers.</p>
          <p>However, official hosted instances may rely on third-party hosting providers, content delivery networks, and other infrastructure services.</p>
          <p>These third parties may independently process technical information, including IP addresses, network requests, and infrastructure logs, in accordance with their own privacy policies and applicable laws.</p>
          <p>WebXReader does not control the independent data processing practices, operational policies, or availability of these third-party providers.</p>
          <p>Users are encouraged to review the applicable privacy policies and terms of any third-party services they choose to access.</p>
        </TermsSection>

        <TermsSection title="9. Offline Functionality">
          <p>WebXReader is designed to support offline functionality where technically feasible.</p>
          <p>Offline availability may depend on factors including browser capabilities, previously downloaded application resources, cached assets, storage availability, supported file formats, and the requirements of individual features.</p>
          <p>Certain features, updates, resources, or initial application loading may require an internet connection.</p>
          <p>WebXReader does not guarantee that every feature will remain available offline under all circumstances.</p>
        </TermsSection>

        <TermsSection title="10. File Compatibility and Processing">
          <p>WebXReader supports various digital reading, document, image, and archive formats.</p>
          <p>Support for a file format does not guarantee compatibility with every file, specification version, encoding, extension, encryption mechanism, or implementation of that format.</p>
          <p>Files may contain malformed data, unsupported features, corrupted structures, or other characteristics that prevent successful processing.</p>
          <p>WebXReader does not guarantee the accuracy, completeness, or fidelity of rendered content, extracted metadata, dictionary definitions, reading statistics, or other processed information.</p>
          <p>Users should independently verify information where accuracy is important and retain original copies of their materials.</p>
          <p>WebXReader should not be relied upon as the sole means of accessing critical, irreplaceable, or legally significant documents.</p>
        </TermsSection>

        <TermsSection title="11. Application Availability and Maintenance">
          <p>WebXReader is independently maintained and is provided on an ongoing development basis.</p>
          <p>The application may undergo updates, maintenance, architectural changes, feature modifications, or temporary interruptions.</p>
          <p>WebXReader and its maintainers do not guarantee:</p>
          <ul>
            <li>Continuous or uninterrupted service availability.</li>
            <li>Compatibility with every browser, device, or operating system.</li>
            <li>Permanent availability of any particular feature.</li>
            <li>Backward compatibility with all previous application versions.</li>
            <li>A specific development roadmap or release schedule.</li>
            <li>The resolution of every reported defect or compatibility issue.</li>
            <li>Continued maintenance or support for any particular period.</li>
          </ul>
          <p>The maintainers may modify, suspend, replace, or discontinue hosted instances or features where necessary, subject to applicable law.</p>
          <p>Such changes do not revoke rights already granted under the applicable open-source software license.</p>
        </TermsSection>

        <TermsSection title="12. Donations and Sponsorships">
          <p>WebXReader may accept voluntary donations, sponsorships, or other forms of financial or non-financial support.</p>
          <p>Unless expressly stated otherwise, donations are voluntary contributions intended to support the development, maintenance, and operation of the project.</p>
          <p>Making a donation does not automatically establish a contractual entitlement to:</p>
          <ul>
            <li>Premium functionality.</li>
            <li>Priority technical support.</li>
            <li>Guaranteed feature development.</li>
            <li>Specific release dates.</li>
            <li>Continued service availability.</li>
            <li>Ownership or control over the project.</li>
            <li>Influence over development or architectural decisions.</li>
          </ul>
          <p>Payments processed through third-party donation platforms may be subject to the respective platform's terms, policies, fees, and refund procedures.</p>
          <p>Nothing in this section limits any rights or remedies available under applicable law.</p>
        </TermsSection>

        <TermsSection title="13. Open-Source Licensing">
          <p>WebXReader is distributed under the GNU Affero General Public License, version 3 (AGPL-3.0), as specified in its official source code repository.</p>
          <p>The applicable software license governs your rights to use, study, modify, reproduce, and distribute the software.</p>
          <p>These Terms of Use govern the use of WebXReader's official hosted application and associated services. They do not replace, amend, or impose additional restrictions on the rights granted under the AGPL-3.0.</p>
          <p>Where a conflict arises concerning rights granted under the software license, the applicable open-source license shall govern those rights.</p>
          <p>Third-party libraries, dependencies, fonts, assets, and other incorporated materials may be subject to their respective licenses.</p>
          <p>The official source code repository and applicable licensing information are available at:</p>
          <a className={styles.documentLink} href={projectRepository} target="_blank" rel="noopener noreferrer">{projectRepository}</a>
        </TermsSection>

        <TermsSection title="14. Disclaimer of Warranties">
          <p>To the maximum extent permitted by applicable law, WebXReader and its associated services are provided on an <strong>"AS IS"</strong> and <strong>"AS AVAILABLE"</strong> basis, without warranties or guarantees of any kind, whether express, implied, or statutory.</p>
          <p>This includes, without limitation, implied warranties of merchantability, fitness for a particular purpose, accuracy, reliability, availability, and non-infringement.</p>
          <p>WebXReader and its maintainers do not warrant that:</p>
          <ul>
            <li>The application will operate without interruption, errors, or defects.</li>
            <li>All security vulnerabilities will be identified or resolved.</li>
            <li>All imported materials will be processed accurately or successfully.</li>
            <li>Locally stored data will remain permanently accessible or recoverable.</li>
            <li>The application will meet every user's individual requirements.</li>
            <li>Third-party infrastructure will remain available or operate without interruption.</li>
          </ul>
          <p>You acknowledge that your use of WebXReader involves the ordinary risks associated with software, browser-based storage, and digital file processing.</p>
          <p>Nothing in these terms excludes warranties or protections that cannot lawfully be excluded.</p>
        </TermsSection>

        <TermsSection title="15. Limitation of Liability">
          <p>To the maximum extent permitted by applicable law, WebXReader, its maintainers, developers, and contributors shall not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages arising out of or relating to the use of, or inability to use, the application or its associated services.</p>
          <p>This includes, without limitation:</p>
          <ul>
            <li>Loss, corruption, deletion, or inaccessibility of data.</li>
            <li>Loss of books, documents, notes, bookmarks, or reading progress.</li>
            <li>Loss of time, productivity, business opportunities, or profits.</li>
            <li>Application defects, compatibility issues, or service interruptions.</li>
            <li>Failures or actions of third-party infrastructure providers.</li>
            <li>Unauthorized access resulting from circumstances outside the maintainers' reasonable control.</li>
            <li>User actions, misuse, or failure to maintain adequate backups.</li>
            <li>Reliance on inaccurate, incomplete, or incorrectly processed information.</li>
          </ul>
          <p>These limitations apply to the extent permitted by applicable law, regardless of the legal theory under which a claim is brought.</p>
          <p>Nothing in these terms excludes or limits liability for fraud, wilful misconduct, or any other liability that cannot lawfully be excluded or limited.</p>
        </TermsSection>

        <TermsSection title="16. Third-Party Links and Resources">
          <p>WebXReader may contain links to external websites, documentation, repositories, donation platforms, or other third-party resources.</p>
          <p>Such links are provided for convenience and informational purposes.</p>
          <p>The inclusion of a third-party link does not necessarily constitute endorsement of the linked service, its content, or its practices.</p>
          <p>WebXReader and its maintainers are not responsible for the independent operation, content, security, availability, or policies of external services.</p>
        </TermsSection>

        <TermsSection title="17. Changes to These Terms">
          <p>These Terms of Use may be revised periodically to reflect changes in the application, its infrastructure, applicable laws, or operational requirements.</p>
          <p>Updated terms will be made available through the application or its official repository, together with an updated effective date.</p>
          <p>Where required by applicable law, reasonable notice of material changes will be provided.</p>
          <p>Continued use of WebXReader following the effective date of updated terms constitutes acceptance of those terms to the extent permitted by applicable law.</p>
        </TermsSection>

        <TermsSection title="18. Governing Law and Jurisdiction">
          <p>These Terms of Use shall be governed by and interpreted in accordance with the applicable laws of India.</p>
          <p>Subject to applicable mandatory consumer protection laws and other jurisdictional requirements, disputes arising from these terms or the use of WebXReader shall be subject to the jurisdiction of competent courts in Bengaluru, Karnataka, India.</p>
          <p>Nothing in this section deprives users of mandatory legal protections available to them under applicable law.</p>
        </TermsSection>

        <TermsSection title="19. Severability">
          <p>If any provision of these Terms of Use is determined to be invalid, unlawful, or unenforceable, that provision shall be limited or severed to the extent necessary.</p>
          <p>The remaining provisions shall continue to apply to the extent permitted by law.</p>
        </TermsSection>

        <TermsSection title="20. Contact Information">
          <p>Questions, concerns, technical issues, or other inquiries regarding WebXReader may be directed through its official project repository:</p>
          <a className={styles.documentLink} href={projectRepository} target="_blank" rel="noopener noreferrer">{projectRepository}</a>
          <p>
            Security vulnerabilities should be reported through the procedures specified in the project's{' '}
            <a href={projectRepository + '/security/policy'} target="_blank" rel="noopener noreferrer">Security Policy</a>.
          </p>
          <p>Users should avoid including confidential information, personal library contents, or other sensitive materials in publicly accessible issue reports.</p>
        </TermsSection>
      </div>

      <p className={styles.summary}>
        <strong>WebXReader is an independently maintained, open-source project committed to accessible, private, and user-controlled digital reading.</strong>
      </p>
    </article>
  );
}
