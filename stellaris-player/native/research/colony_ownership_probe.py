# SPDX-License-Identifier: GPL-3.0-only
"""Bounded, read-only colony relationships relative to a supplied country.

The caller must independently obtain and revalidate the local player's country;
this module never treats country 0 or a caller argument as proof of that role.
"""
from stellaris_memory_probe import number, ProbeError

def resolve_ref(memory, base, database_rva, handle, id_offset):
    if type(handle) is not int or not 0 <= handle < 0xFFFFFFFF:
        raise ProbeError('invalid_entity_handle')
    database=number(memory,base+database_rva)
    if database<0x10000:raise ProbeError('entity_database_unknown')
    count=number(memory,database+0x20,'<I')
    if count>1000000 or (handle&0xFFFFFF)>=count:raise ProbeError('entity_handle_out_of_range')
    table=number(memory,database+0x18)
    if table<0x10000:raise ProbeError('entity_table_unknown')
    obj=number(memory,table+(handle&0xFFFFFF)*16+8)
    if obj<0x10000 or number(memory,obj+id_offset,'<I')!=handle:raise ProbeError('entity_generation_mismatch')
    return obj

def owned_colony_relationship(memory,base,planet_id,country_id,expected_colony_id):
    planet=resolve_ref(memory,base,0x3114E10,planet_id,0x18)
    country=resolve_ref(memory,base,0x3114C38,country_id,0x20)
    if number(memory,planet+0xD0,'<I')!=country_id:raise ProbeError('planet_not_owned_by_country')
    colony_id=number(memory,planet+0xE0,'<I')
    if colony_id!=expected_colony_id:raise ProbeError('planet_colony_handle_changed')
    colony=resolve_ref(memory,base,0x3114E28,colony_id,0x10)
    if number(memory,colony+0xF78,'<I')!=planet_id:raise ProbeError('colony_planet_backlink_mismatch')
    data=number(memory,country+0x26C0);count=number(memory,country+0x26CC,'<I')
    if count>65536 or count and data<0x10000:raise ProbeError('owned_colony_list_unknown')
    if colony_id not in [number(memory,data+i*4,'<I') for i in range(count)]:raise ProbeError('colony_not_in_owned_list')
    return {'countryId':country_id,'planetId':planet_id,'colonyId':colony_id,
            'ownershipRelationshipVerified':True,'playerBindingVerified':False,
            'constructionQueueId':number(memory,planet+0xE4,'<I')}
