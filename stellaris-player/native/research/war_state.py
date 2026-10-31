# SPDX-License-Identifier: GPL-3.0-only
"""Exact-build read-only primary-war state, separate from engine command code."""
from stellaris_memory_probe import number,ProbeError

INVALID=0xFFFFFFFF

def key(memory,definition):
    if not definition:return None
    address=definition+0x20
    length=number(memory,address+16);capacity=number(memory,address+24)
    if not 0<length<=100:return None
    return memory.read(address if capacity<16 else number(memory,address),length).decode('utf-8',errors='replace')

def goal(memory,address):
    return {'key':key(memory,number(memory,address+8)),
            'actor_country_id':number(memory,address+0x14,'<I'),
            'target_country_id':number(memory,address+0x18,'<I')}

def read_wars(memory,country_id):
    if type(country_id) is not int or not 0<=country_id<INVALID:raise ProbeError('invalid_country_id')
    database=number(memory,memory.base+0x3114D10)
    if not database:raise ProbeError('war_database_unavailable')
    count=number(memory,database+0x20,'<I');array=number(memory,database+0x18)
    if count>4096 or (count and not array):raise ProbeError('war_database_bounds')
    wars=[]
    for slot in range(count):
        war=number(memory,array+slot*16+8)
        if not war:continue
        identifier=number(memory,war+0x20,'<I')
        if identifier&0xFFFFFF!=slot:continue
        attacker=goal(memory,war+0xD0);defender=goal(memory,war+0xF0)
        a_count=number(memory,war+0x94,'<I');d_count=number(memory,war+0xAC,'<I')
        a_data=number(memory,war+0x88);d_data=number(memory,war+0xA0)
        if not 0<a_count<=128 or not 0<d_count<=128 or not a_data or not d_data:continue
        primary_attacker=number(memory,a_data+8,'<I');primary_defender=number(memory,d_data+8,'<I')
        if country_id not in (primary_attacker,primary_defender):continue
        wars.append({'war_id':identifier,'player_side':'attacker' if primary_attacker==country_id else 'defender',
                     'primary_attacker_id':primary_attacker,'primary_defender_id':primary_defender,
                     'attacker_goal':attacker,'defender_goal':defender,
                     'have_defender_war_goal':number(memory,war+0x110,'<B')!=0,
                     'attacker_exhaustion':number(memory,war+0x118,'<q')/100000,
                     'defender_exhaustion':number(memory,war+0x120,'<q')/100000})
    return wars

def read_war_goal_window(memory):
    idler=number(memory,memory.base+0x3114E68)
    if not idler:return False
    view=number(memory,idler+0xC18)
    if not view or number(memory,view)!=memory.base+0x240F2D0:return False
    ui=number(memory,view+0x78)
    return bool(ui and number(memory,ui+0x41,'<B'))
