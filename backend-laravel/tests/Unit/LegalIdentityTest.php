<?php

namespace Tests\Unit;

use App\Support\LegalIdentity;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class LegalIdentityTest extends TestCase
{
    /** @return array<string, mixed> */
    private function identity(): array
    {
        return [
            'name' => 'Prestador de prueba',
            'tax_id' => 'TEST',
            'address' => 'Domicilio de prueba, España',
            'registry' => 'Registro público de prueba',
            'hosting_provider' => 'Proveedor de prueba',
            'hosting_region' => 'Unión Europea',
        ];
    }

    public function test_legacy_registered_identity_is_bounded_normalized_and_public_only(): void
    {
        $values = $this->identity();
        $values['name'] = '  Prestador de prueba  ';
        $values['private_key'] = 'fictional-secret-must-not-be-published';
        $this->assertSame([
            'name' => 'Prestador de prueba',
            'taxId' => 'TEST',
            'address' => 'Domicilio de prueba, España',
            'registryStatus' => 'registered',
            'registry' => 'Registro público de prueba',
            'hostingProvider' => 'Proveedor de prueba',
            'hostingRegion' => 'Unión Europea',
        ], LegalIdentity::publicProjection($values));
    }

    public function test_unregistered_declaration_publishes_null_without_fictitious_registry_text(): void
    {
        foreach ([null, '', '   '] as $registry) {
            $values = $this->identity();
            $values['registry_status'] = 'not_registered';
            $values['registry'] = $registry;
            $projection = LegalIdentity::publicProjection($values);
            $this->assertNotNull($projection);
            $this->assertSame('not_registered', $projection['registryStatus']);
            $this->assertNull($projection['registry']);
        }
    }

    public function test_registered_status_never_accepts_an_absent_registry(): void
    {
        foreach ([null, '', '   '] as $registry) {
            $values = $this->identity();
            $values['registry'] = $registry;
            $this->assertNull(LegalIdentity::publicProjection($values));
        }
    }

    public function test_unknown_or_contradictory_declarations_are_not_published(): void
    {
        foreach (['unknown', '', null, false, [], 'not_registered'] as $status) {
            $values = $this->identity();
            $values['registry_status'] = $status;
            $this->assertNull(LegalIdentity::publicProjection($values));
        }
    }

    #[DataProvider('invalidFields')]
    public function test_incomplete_or_unsafe_identity_is_never_partially_published(string $field, mixed $value): void
    {
        $values = $this->identity();
        $values[$field] = $value;
        $this->assertNull(LegalIdentity::publicProjection($values));
        $values['registry_status'] = 'not_registered';
        if ($field !== 'registry') {
            $values['registry'] = null;
        }
        $this->assertNull(LegalIdentity::publicProjection($values));
    }

    /** @return array<string, array{string, mixed}> */
    public static function invalidFields(): array
    {
        return [
            'missing name' => ['name', null],
            'blank name' => ['name', '   '],
            'short name' => ['name', 'A'],
            'long Unicode name' => ['name', str_repeat('ñ', 201)],
            'missing tax id' => ['tax_id', null],
            'wrong type' => ['tax_id', 123456],
            'short address' => ['address', 'Madrid'],
            'placeholder address' => ['address', 'Domicilio pendiente de completar'],
            'embedded controls' => ['address', "Domicilio de prueba\nMadrid"],
            'invalid UTF8' => ['address', "Domicilio de prueba \xff"],
            'placeholder registry' => ['registry', 'Pendiente de completar'],
            'long registry' => ['registry', str_repeat('ñ', 501)],
            'missing hosting' => ['hosting_provider', null],
            'array region' => ['hosting_region', ['España']],
            'placeholder provider' => ['hosting_provider', 'Example hosting'],
        ];
    }
}
