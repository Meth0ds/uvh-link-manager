<?php

return [
    'plan' => 'standard',
    'limits' => [
        'members' => (int) env('WORKSPACE_MEMBERS_LIMIT', 1000),
        'domains' => (int) env('WORKSPACE_DOMAINS_LIMIT', 20),
        'tokens' => (int) env('WORKSPACE_TOKENS_LIMIT', 20),
        'webhooks' => (int) env('WORKSPACE_WEBHOOKS_LIMIT', 20),
        'invitations' => (int) env('WORKSPACE_INVITATIONS_LIMIT', 100),
        'collections' => (int) env('WORKSPACE_COLLECTIONS_LIMIT', 500),
        'tags' => (int) env('WORKSPACE_TAGS_LIMIT', 500),
        'templates' => (int) env('WORKSPACE_TEMPLATES_LIMIT', 200),
    ],
];
