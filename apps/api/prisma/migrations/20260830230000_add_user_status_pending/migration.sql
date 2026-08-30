-- Self-serve signups used to be created ACTIVE with an ADMIN role, so anyone
-- who found the public login page held platform admin. PENDING is the state a
-- signup lands in now: every authentication path already refuses a user whose
-- status is not ACTIVE, so a pending account can obtain no session at all until
-- an existing admin approves it.
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'PENDING';
