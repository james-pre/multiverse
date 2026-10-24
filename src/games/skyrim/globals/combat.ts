import { array, primitive, struct, types as t } from 'memium';
import { RefID } from '../ref-id.js';
import { getVsval, vsval } from '../vsval.js';

/*
# Combat
Name 	Type/Size 	Info
nextNum 	uint32 	This value is assigned to the next combat
count0 	vsval 	
unknown 	Unknown0[count0] 	
count1 	vsval 	
unknown 	Unknown1[count1] 	
unknown 	float 	
unknown 	vsval 	
count2 	vsval 	
unknown 	RefID[count2] 	
unknown 	float 	
unknown 	UnkStruct 	
unknown 	UnkStruct 	
# Unknown0
Name 	Type/Size 	Info
unknown 	uint32 	
serialNum 	uint32 	Assigned in accordance with nextNum
unknown 	Unknown0_0 	
## Unknown0_0
Name 	Type/Size 	Info
count0 	vsval 	
unknown 	Unknown0_0_0[count0] 	
count1 	vsval 	
unknown 	Unknown0_0_1[count1] 	
unknown 	UnkStruct 	
unknown 	UnkStruct 	
unknown 	UnkStruct 	
unknown 	UnkStruct 	
unknown 	UnkStruct[11] 	
unknownFlag 	uint32 	
unknown 	Unknown0_0_2 	This value is only present if unknownFlag is not zero.
unknown 	UnkStruct 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	UnkStruct 	
unknown 	uint8 	
### Unknown0_0_0
Name 	Type/Size 	Info
unknown 	RefID 	
unknown 	uint32 	
unknown 	float 	
unknown 	uint16 	
unknown 	uint16 	
target 	RefID 	
unknown 	Position 	
unknown 	Position 	
unknown 	Position 	
unknown 	Position 	
unknown 	Position 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
### Unknown0_0_1
Name 	Type/Size 	Info
unknown 	RefID 	
unknown 	float 	
unknown 	float 	
### Unknown0_0_2
Name 	Type/Size 	Info
unknown 	RefID 	
unknown 	UnkStruct 	
unknown 	UnkStruct 	
unknown 	float 	
unknown 	Position 	
unknown 	float 	
count0 	vsval 	
unknown 	Unknown0_0_2_0[count0] 	
count1 	vsval 	
unknown 	Unknown0_0_2_1[count1] 	
unknownFlag 	uint8 	
unknown 	Unknown0_0_2_2 	This value is only present if unknownFlag is not zero.
### Unknown0_0_2_0
Name 	Type/Size 	Info
unknown 	Position 	
unknown 	uint32 	
unknown 	float 	
### Unknown0_0_2_1
Name 	Type/Size 	Info
unknown 	RefID 	
unknown 	RefID 	
unknown 	uint8 	
unknown 	uint8 	
unknown 	uint8 	
### Unknown0_0_2_2
Name 	Type/Size 	Info
unknown 	uint32 	
unknown 	uint32 	
count0 	uint32 	
### unknown 	Unknown0_0_2_2_0[count0] 	
unknown 	RefID 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	RefID 	
unknown 	float 	
unknown 	RefID 	
unknown 	uint16 	
unknown 	uint8 	
unknown 	uint8 	
unknown 	float 	
unknown 	float 	
### Unknown0_0_2_2_0
Name 	Type/Size 	Info
unknown 	uint8 	
count0 	uint32 	
unknown 	uint8[count0] 	
unknown 	RefID 	
unknown 	uint32 	
## Unknown1
Name 	Type/Size 	Info
unknown 	RefID 	
unknown 	float 	
unknown 	Unknown1_0 	
## Unknown1_0
Name 	Type/Size 	Info
unknown 	RefID 	
unknown 	RefID 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
x 	float 	
y 	float 	
z 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	float 	
unknown 	RefID 	
## Position

This isn't used only by Combat. Need to move it out once its observed in other documented places.
Name 	Type/Size 	Info
x 	float 	
y 	float 	
z 	float 	
cellID 	RefID 	
## UnkStruct
Name 	Type/Size 	Info
unknown 	float 	
unknown 	float 

*/

const Combat_UnkStruct = struct.packed('Combat_UnkStruct', {
	unknown0: t.float32,
	unknown1: t.float32,
});

/** This isn't used only by Combat. Need to move it out once its observed in other documented places. */
export const Position = struct.packed('Position', {
	x: t.float32,
	y: t.float32,
	z: t.float32,
	cellID: RefID,
});

const Combat_Unknown0_0_0 = struct.packed('Combat_Unknown0_0_0', {
	id: RefID,
	unknownU32: t.uint32,
	unknownFloat: t.float32,
	unknownU16_0: t.uint16,
	unknownU16_1: t.uint16,
	target: RefID,
	positions: array(Position, 5),
	floats: t.float32(6),
});

const Combat_Unknown0_0_1 = struct.packed('Combat_Unknown0_0_1', {
	id: RefID,
	float0: t.float32,
	float1: t.float32,
});

const Combat_Unknown0_0_2_0 = struct.packed('Combat_Unknown0_0_2_0', {
	position: Position,
	unknownU32: t.uint32,
	unknownFloat: t.float32,
});

const Combat_Unknown0_0_2_1 = struct.packed('Combat_Unknown0_0_2_1', {
	id0: RefID,
	id1: RefID,
	unknowns: t.uint8(3),
});

const Combat_Unknown0_0_2_2_0 = struct.packed(
	'Combat_Unknown0_0_2_2_0',
	{
		unknownU8: t.uint8,
		count0: t.uint32,
		unknown0: array(primitive.types.uint8).countedBy((c) => c.count0),
		id: RefID,
		unknownU32: t.uint32,
	},
	{ isDynamic: true }
);

const Combat_Unknown0_0_2_2 = struct.packed(
	'Combat_Unknown0_0_2_2',
	{
		unknownU32_0: t.uint32,
		unknownU32_1: t.uint32,
		count0: t.uint32,
		unknown0: array(Combat_Unknown0_0_2_2_0).countedBy((c) => c.count0),
		id0: RefID,
		floats5: t.float32(5),
		id1: RefID,
		float1: t.float32,
		id2: RefID,
		unknownU16: t.uint16,
		unknownU8_0: t.uint8,
		unknownU8_1: t.uint8,
		float2: t.float32,
		float3: t.float32,
	},
	{ isDynamic: true }
);

const Combat_Unknown0_0_2 = struct.packed(
	'Combat_Unknown0_0_2',
	{
		id: RefID,
		unkStruct0: Combat_UnkStruct,
		unkStruct1: Combat_UnkStruct,
		float0: t.float32,
		position: Position,
		float1: t.float32,
		count0: vsval,
		unknown0: array(Combat_Unknown0_0_2_0).countedBy((c) => getVsval(c.count0)),
		count1: vsval,
		unknown1: array(Combat_Unknown0_0_2_1).countedBy((c) => getVsval(c.count1)),
		unknownFlag: t.uint8,
		unknown2: array(Combat_Unknown0_0_2_2).countedBy((c) => +!!c.unknownFlag),
	},
	{ isDynamic: true }
);

const Combat_Unknown0_0 = struct.packed(
	'Combat_Unknown0_0',
	{
		count0: vsval,
		unknown0: array(Combat_Unknown0_0_0).countedBy((c) => getVsval(c.count0)),
		count1: vsval,
		unknown1: array(Combat_Unknown0_0_1).countedBy((c) => getVsval(c.count1)),
		unk15: array(Combat_UnkStruct, 15),
		flag: t.uint32,
		unknown2: array(Combat_Unknown0_0_2).countedBy((c) => +!!c.flag),
		unk3: array(Combat_UnkStruct, 4),
		unknown: t.uint8,
	},
	{ isDynamic: true }
);

const Combat_Unknown0 = struct.packed('Combat_Unknown0', {
	unknown: t.uint32,
	/* Assigned in accordance with nextNum */
	serialNum: t.uint32,
	unknown0: Combat_Unknown0_0,
});

const Combat_Unknown1_0 = struct.packed('Combat_Unknown1_0', {
	id0: RefID,
	id1: RefID,
	unknownFloats3: t.float32(3),
	x: t.float32,
	y: t.float32,
	z: t.float32,
	unknownFloats8: t.float32(8),
	lastID: RefID,
});

const Combat_Unknown1 = struct.packed('Combat_Unknown1', {
	id: RefID,
	unknownFloat: t.float32,
	unknown0: Combat_Unknown1_0,
});

export const Combat = struct.packed(
	'Combat',
	{
		/** This value is assigned to the next combat */
		nextNum: t.uint32,
		count0: vsval,
		unknown0: array(Combat_Unknown0).countedBy((c) => getVsval(c.count0)),
		count1: vsval,
		unknown1: array(Combat_Unknown1).countedBy((c) => getVsval(c.count1)),
		unknown2: t.float32,
		unknown3: vsval,
		count2: vsval,
		unknown4: array(RefID).countedBy((c) => getVsval(c.count2)),
		unknown5: t.float32,
		unknown6: Combat_UnkStruct,
		unknown7: Combat_UnkStruct,
	},
	{ isDynamic: true }
);
