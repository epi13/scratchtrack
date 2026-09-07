#!/usr/bin/env python3
"""Build mncs/probes/events_transport-corpus.json (finite-discriminant enum
encoding mirrors the platform-capability corpus)."""
import json
from pathlib import Path

M = 'scratchtrack.probes.events_transport_attempt'


def finite(typ, var, disc):
    return {'finite': {
        'type_identity': f'mncs:0.2:finite-type:{M}::{typ}',
        'variant_identity': f'mncs:0.2:finite-variant:{M}::{typ}::{var}',
        'discriminant': disc}}


def transport(phase, disc):
    from urllib.parse import quote
    finite_ty = quote(f'mncs:0.2:finite-type:{M}::Phase', safe='')
    identity = (f'mncs:0.2:record-type:{M}::Transport::'
                f'armed%3Abool%3Bphase%3A{finite_ty}%3B')
    return {'record': {'type_identity': identity, 'name': 'Transport', 'fields': [
        ('armed', {'boolean': {'value': True}}),
        ('phase', finite('Phase', phase, disc))]}}


def req(fn, args):
    return {'schema_version': '0.1', 'step_budget': 2048,
            'target': {'module': M, 'function': fn}, 'arguments': args}


cases = [
    {'id': 'play-from-stop', 'request': req('transport_step', [
        transport('stopped', 0), finite('Evt', 'play', 0)]),
     'expected_status': 'returned'},
    {'id': 'stop-disarms', 'request': req('transport_step', [
        transport('playing', 1), finite('Evt', 'stop', 2)]),
     'expected_status': 'returned'},
    {'id': 'is-playing', 'request': req('is_playing', [transport('playing', 1)]),
     'expected_status': 'returned', 'expected': [{'boolean': {'value': True}}]},
]
dest = Path(__file__).resolve().parent.parent / 'mncs' / 'probes' / 'events_transport-corpus.json'
dest.write_text(json.dumps(
    {'schema_version': '0.1', 'name': 'events-transport', 'cases': cases}, indent=1) + '\n')
print(f'wrote {dest} with {len(cases)} cases')
