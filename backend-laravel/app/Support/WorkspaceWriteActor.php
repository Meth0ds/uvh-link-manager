<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** A request snapshot, never permission: revalidate it inside the business TX. */
final readonly class WorkspaceWriteActor
{
    /** @param array<string, mixed>|null $apiTokenContext */
    private function __construct(
        private User $snapshot,
        private int $workspaceId,
        private ?string $sessionId,
        private ?array $apiTokenContext,
        private ?string $ip,
    ) {}

    public static function fromRequest(Request $request): self
    {
        $user = UvhRequest::user($request);
        $workspaceId = UvhRequest::workspaceId($request);
        if (! $user || ! $workspaceId) {
            throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
        }

        return new self(clone $user, $workspaceId, UvhRequest::sessionId($request), UvhRequest::apiToken($request), UvhRequest::ip($request));
    }

    /** Admit the native link event in the same transaction as its effect.
     *
     * @param  array<string, mixed>|null  $metadata
     */
    public function auditLink(string $action, int $linkId, ?array $metadata = null): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Link audit admission requires the business transaction');
        }
        Audit::write((int) $this->snapshot->id, $action, 'link', $linkId, $metadata, $this->ip, workspaceId: $this->workspaceId);
    }

    public function lockMembership(int $userId, int $workspaceId, ?int $expectedSecurityVersion = null): ?Membership
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Workspace write authority requires the business transaction');
        }
        if ($userId !== (int) $this->snapshot->id || $workspaceId !== $this->workspaceId
            || ($expectedSecurityVersion !== null && $expectedSecurityVersion !== (int) $this->snapshot->security_version)) {
            return null;
        }
        if ($this->apiTokenContext !== null) {
            return WorkspaceAccess::getMembershipLocked(
                $userId, $workspaceId, 'editor', $this->apiTokenContext,
                'links:write', (int) $this->snapshot->security_version,
            );
        }

        $context = SecurityContext::lock($this->snapshot, $this->sessionId, requireVerifiedEmail: true);

        return $context ? WorkspaceAccess::getMembershipForContext($context, $workspaceId, 'editor') : null;
    }
}
