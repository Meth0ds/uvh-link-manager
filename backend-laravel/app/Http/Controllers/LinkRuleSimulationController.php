<?php

namespace App\Http\Controllers;

use App\Models\Link;
use App\Support\LinkService;
use App\Support\RedirectRuleMatcher;
use App\Support\RedirectService;
use App\Support\RuleConflictAnalyzer;
use App\Support\UrlUtil;
use App\Support\UvhRequest;
use Carbon\CarbonImmutable;
use DateTimeZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class LinkRuleSimulationController
{
    public function store(Request $request): JsonResponse
    {
        if (! config('workflows.rule_simulator', true)) {
            return response()->json(['error' => __('messages.error_082a2b7ba08855')], 404);
        }
        $workspaceId = UvhRequest::workspaceId($request);
        $link = null;
        $linkId = $request->input('linkId');
        if ($linkId !== null) {
            if (! is_int($linkId) || $linkId < 1) {
                return response()->json(['error' => __('messages.error_00078a605b28f0')], 422);
            }
            $link = Link::where('id', $linkId)->where('workspace_id', $workspaceId)->whereNull('deleted_at')->first();
            if (! $link) {
                return response()->json(['error' => __('messages.error_56cb73fa20e635')], 404);
            }
        }
        // A link id selects the saved, authorized configuration. Never let a
        // caller mix a real link identity with an untrusted destination or
        // rule draft; drafts omit linkId and are validated below.
        $rules = $link !== null
            ? $link->rules()->orderBy('priority')->orderBy('id')->get()->map(fn ($rule) => $rule->only(['id', 'priority', 'country', 'language', 'device', 'os', 'time_from', 'time_to', 'referrer', 'campaign', 'destination']))->all()
            : $request->input('rules');
        if (! is_array($rules)) {
            return response()->json(['error' => __('messages.error_df12cc4add1d10')], 422);
        }
        $rules = array_values(array_map(static function (mixed $rule): array {
            if (! is_array($rule)) {
                return [];
            }

            return [
                'id' => $rule['id'] ?? null,
                'priority' => $rule['priority'] ?? 0,
                'country' => $rule['country'] ?? null,
                'language' => $rule['language'] ?? null,
                'device' => $rule['device'] ?? null,
                'os' => $rule['os'] ?? null,
                'time_from' => $rule['time_from'] ?? $rule['timeFrom'] ?? null,
                'time_to' => $rule['time_to'] ?? $rule['timeTo'] ?? null,
                'referrer' => $rule['referrer'] ?? null,
                'campaign' => $rule['campaign'] ?? null,
                'destination' => $rule['destination'] ?? null,
            ];
        }, $rules));
        $utm = $link !== null ? [
            'source' => $link->utm_source, 'medium' => $link->utm_medium, 'campaign' => $link->utm_campaign,
            'term' => $link->utm_term, 'content' => $link->utm_content,
        ] : $request->input('utm', []);
        if (! is_array($utm)) {
            return response()->json(['error' => __('messages.error_f636538a514903')], 422);
        }
        $input = [
            'destination' => $link !== null ? $link->destination : $request->input('destination'),
            'fallback_destination' => $link !== null ? $link->fallback_destination : $request->input('fallbackDestination'),
            'rules' => $rules,
            'utm' => $utm,
        ];
        $valid = LinkService::validate($input);
        if (! $valid['ok']) {
            return response()->json(['error' => $valid['error']], 422);
        }
        $timezoneName = $request->input('timezone');
        if ($request->input('localTime') !== null && $timezoneName === null) {
            return response()->json(['error' => __('messages.error_f6263da85cc005')], 422);
        }
        $now = CarbonImmutable::now('UTC');
        $timezoneWarnings = [];
        if ($timezoneName !== null) {
            if (! is_string($timezoneName) || ! in_array($timezoneName, DateTimeZone::listIdentifiers(), true)) {
                return response()->json(['error' => __('messages.error_7ae15470e1e750')], 422);
            }
            $localTime = $request->input('localTime');
            if ($localTime !== null && (! is_string($localTime) || preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $localTime) !== 1)) {
                return response()->json(['error' => __('messages.error_1cbd17557b9d31')], 422);
            }
            if ($localTime !== null) {
                $zone = new DateTimeZone($timezoneName);
                $localDate = CarbonImmutable::now($zone)->format('Y-m-d');
                $localValue = $localDate.' '.$localTime;
                $naive = CarbonImmutable::createFromFormat('!Y-m-d H:i', $localValue, 'UTC');
                if ($naive === null) {
                    return response()->json(['error' => __('messages.error_1cbd17557b9d31')], 422);
                }
                $naiveTimestamp = $naive->timestamp;
                $candidates = [];
                $offsets = [];
                foreach ($zone->getTransitions($naiveTimestamp - 86_400, $naiveTimestamp + 86_400) ?: [] as $transition) {
                    $offsets[(int) $transition['offset']] = true;
                }
                foreach (array_keys($offsets) as $offset) {
                    $candidate = CarbonImmutable::createFromTimestampUTC($naiveTimestamp - (int) $offset);
                    if ($candidate->setTimezone($zone)->format('Y-m-d H:i') === $localValue) {
                        $candidates[] = $candidate;
                    }
                }
                if ($candidates === []) {
                    return response()->json(['error' => __('messages.error_5831ba09535b63')], 422);
                }
                if (count($candidates) > 1) {
                    $timezoneWarnings[] = 'ambiguous_local_time';
                }
                $now = $candidates[0]->utc();
            }
        }
        $language = $request->input('language');
        if ($language !== null && (! is_string($language) || preg_match('/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/iD', $language) !== 1)) {
            return response()->json(['error' => __('messages.error_c8a3420e3f73fb')], 422);
        }
        $device = $request->input('device');
        if ($device !== null && ! in_array($device, ['desktop', 'mobile', 'tablet'], true)) {
            return response()->json(['error' => __('messages.error_a39fe73b5ab199')], 422);
        }
        $country = $request->input('country');
        if ($country !== null && (! is_string($country) || preg_match('/^[a-z]{2}$/iD', $country) !== 1)) {
            return response()->json(['error' => __('messages.error_b14324b5233f6c')], 422);
        }
        foreach (['os' => 40, 'campaign' => 100, 'referrer' => 200] as $field => $max) {
            $value = $request->input($field);
            if ($value !== null && (! is_string($value) || mb_strlen($value) > $max || preg_match('/[\x00-\x1f\x7f]/', $value))) {
                return response()->json(['error' => __('messages.error_ac10e0e5393ba9')], 422);
            }
        }
        $result = RedirectRuleMatcher::evaluate(
            $rules,
            (string) $input['destination'],
            $input['fallback_destination'] ?: null,
            array_map(static fn ($value) => is_string($value) && $value !== '' ? $value : null, $input['utm']),
            [
                'country' => $country, 'languages' => $language ? [strtolower($language)] : [],
                'device' => $device, 'os' => $request->input('os'),
                'referrer' => is_string($request->input('referrer')) ? RedirectService::referrerDomain($request->input('referrer')) : null,
                'campaign' => $request->input('campaign'),
            ],
            $now,
        );
        if (! UrlUtil::validateDestination($result['destination'])['ok'] || ! UrlUtil::validateDestination($result['destinationWithUtm'])['ok']) {
            return response()->json(['error' => __('messages.error_e0a782602aeddd')], 422);
        }
        $normalizedRules = $rules;

        $warnings = RuleConflictAnalyzer::analyze($normalizedRules);
        $warnings['timezoneWarnings'] = $timezoneWarnings;

        return response()->json([
            ...$result,
            'evaluatedAtUtc' => $now->toIso8601String(),
            'input' => $request->only(['linkId', 'country', 'device', 'language', 'os', 'referrer', 'campaign', 'localTime', 'timezone']),
            'warnings' => $warnings,
        ]);
    }
}
