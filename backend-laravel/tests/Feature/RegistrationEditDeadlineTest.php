<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use App\Support\Ids;
use App\Support\RegistrationEdit;
use App\Support\SealedToken;
use App\Support\SealFormatTelemetry;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Tests\TestCase;

#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
final class RegistrationEditDeadlineTest extends TestCase
{
    public static function deadlines(): array
    {
        $cases = [];
        foreach ([2, 3, 4] as $version) {
            foreach ([false, true] as $legacy) {
                foreach ([1, 0, -1] as $milliseconds) {
                    $cases['v'.$version.' '.($legacy ? 'legacy' : 'current').' '.$milliseconds] = [$legacy, $milliseconds, $version];
                }
            }
        }

        return $cases;
    }

    #[DataProvider('deadlines')]
    public function test_edit_authority_expires_at_its_exact_deadline(bool $legacy, int $milliseconds, int $version): void
    {
        require __DIR__.'/../Support/registration-edit-clock.php';
        $this->assertSame(1_800_000_000_125, (int) (\App\Support\microtime(true) * 1000));
        config(['uvh.secret' => str_repeat('a', 40), 'uvh.secret_previous' => []]);
        $plain = sprintf($version === 2 ? '{"e":%013d,"v":2,"pid":"%010d","sv":"%03d"}' : '{"e":%013d,"v":'.$version.',"pid":"%019d","sv":"%010d"}', 1_800_000_000_125 + $milliseconds, 127, 1);
        if ($legacy) {
            $nonce = str_repeat("\x01", 12);
            $tag = '';
            $cipher = openssl_encrypt($plain, 'aes-256-gcm', hash_hkdf('sha256', str_repeat('a', 40), 32, 'uvh:sealed-token:v1'), OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
            $value = Ids::base64urlEncode($nonce.$tag.$cipher);
        } else {
            $value = SealedToken::seal($plain);
        }
        $before = DB::table('audit_events')->where('action', SealFormatTelemetry::ACTION_LEGACY_OPENED)->count();
        $request = Request::create('/', 'GET', [], [RegistrationEdit::cookieName() => $value]);
        $pending = (new PendingRegistration)->forceFill(['id' => 127, 'security_version' => 1]);

        $attempt = (new RegistrationAttempt)->forceFill(['id' => 127, 'security_version' => 1, 'expires_at' => Carbon::createFromTimestampMs(1_800_000_000_125 + $milliseconds)]);
        $this->assertSame($milliseconds > 0, $version === 4 ? RegistrationEdit::authorizesAttempt($request, $attempt) : RegistrationEdit::authorizes($request, $pending));
        $this->assertSame($before + (int) ($legacy && $milliseconds > 0), DB::table('audit_events')->where('action', SealFormatTelemetry::ACTION_LEGACY_OPENED)->count());
    }
}
