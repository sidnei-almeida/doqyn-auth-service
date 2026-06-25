import type { PublicMembership } from '../memberships/memberships.schemas.js';

export interface AdminActor {
  userId: string;
  membership: PublicMembership;
}
