import {
  jellyMailbox,
  jellyTeam,
  jellyTeamContact,
  marmaladeMailbox,
  marmaladeMailboxMember,
  user,
} from "@marmalade-v2/db/schema/index";

import { testDb } from "./db";

/**
 * Two teams that look alike on purpose.
 *
 * Both own a mailbox called `general`, and one person is staff in both with a
 * different role in each. Nearly every cross-tenant bug this suite guards
 * against is invisible unless the two teams share names.
 */
export const ALPHA = "alpha-team";
export const BETA = "beta-team";

export const SHARED_MAILBOX = "general";

export const PERSON = {
  id: "user-both",
  email: "both@example.com",
  name: "In Both Teams",
};
export const ALPHA_ONLY = {
  id: "user-alpha",
  email: "alpha@example.com",
  name: "Alpha Only",
};
export const OPERATOR = {
  id: "user-operator",
  email: "operator@example.com",
  name: "Instance Operator",
};
/** Admin in Beta only, so "admin" is never the same thing in both teams. */
export const BETA_ADMIN = {
  id: "user-beta-admin",
  email: "beta-admin@example.com",
  name: "Beta Admin",
};

export async function seedTwoTeams() {
  const now = new Date().toISOString();

  await testDb.insert(jellyTeam).values([
    { id: ALPHA, slug: "alpha", name: "Alpha" },
    { id: BETA, slug: "beta", name: "Beta" },
  ]);

  await testDb.insert(user).values(
    [PERSON, ALPHA_ONLY, OPERATOR, BETA_ADMIN].map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );

  await testDb.insert(jellyTeamContact).values([
    // The same person in two teams. Jelly issues a different contact id per
    // team, which is what makes this representable at all.
    {
      id: "contact-alpha-both",
      email: PERSON.email,
      role: "member",
      jellyTeamId: ALPHA,
    },
    {
      id: "contact-beta-both",
      email: PERSON.email,
      role: "member",
      jellyTeamId: BETA,
    },
    {
      id: "contact-beta-admin",
      email: BETA_ADMIN.email,
      role: "admin",
      jellyTeamId: BETA,
    },
    {
      id: "contact-alpha-only",
      email: ALPHA_ONLY.email,
      role: "member",
      jellyTeamId: ALPHA,
    },
    // A correspondent, not staff. Sharing an address with a user must not
    // make the team selectable.
    {
      id: "contact-beta-correspondent",
      email: ALPHA_ONLY.email,
      role: "contact",
      jellyTeamId: BETA,
    },
  ]);

  for (const team of [ALPHA, BETA]) {
    await testDb.insert(jellyMailbox).values({
      jellyMailboxId: SHARED_MAILBOX,
      name: "General",
      jellyTeamId: team,
      createdAt: now,
      updatedAt: now,
      isDefault: true,
    });
    await testDb.insert(marmaladeMailbox).values({
      jellyMailboxId: SHARED_MAILBOX,
      jellyTeamId: team,
      createdAt: now,
      updatedAt: now,
      active: true,
    });
  }

  const mailboxes = await testDb.select().from(marmaladeMailbox);
  const alphaMailbox = mailboxes.find((row) => row.jellyTeamId === ALPHA)!;
  const betaMailbox = mailboxes.find((row) => row.jellyTeamId === BETA)!;

  // Granted in Alpha only. The same mailbox id exists in Beta, which is the
  // trap: a check on the id alone would let this grant through there too.
  await testDb.insert(marmaladeMailboxMember).values({
    marmaladeUserId: PERSON.id,
    marmaladeMailboxId: alphaMailbox.id,
    jellyTeamId: ALPHA,
    createdAt: now,
    updatedAt: now,
  });

  return { alphaMailbox, betaMailbox };
}
