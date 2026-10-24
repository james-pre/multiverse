import { array, primitive, struct, types as t } from 'memium';
import { RefID } from '../ref-id.js';
import { getVsval, vsval } from '../vsval.js';

/*

Quest Static Data
Name 	Type/Size 	Info
count0 	uint32 	
unk0 	QuestRunDataItem3[count0] 	
count1 	uint32 	
unk1 	QuestRunDataItem3[count1] 	
count2 	uint32 	
unk2 	RefID[count2] 	
count3 	uint32 	
unk3 	RefID[count3] 	
count4 	uint32 	
unk4 	RefID[count4] 	
count5 	vsval 	
unk5 	Unknown0[count5] 	
unk6 	uint8 	Always seems to be 1.
Unknown0
Name 	Type/Size 	Info
unk0_0 	RefID 	
count 	vsval 	
Unknown1 	Unknown1[count] 	
Unknown1
Name 	Type/Size 	Info
unk1_0 	uint32 	
unk1_2 	uint32 
*/

const Unknown1 = struct.packed('QuestStaticData_Unknown1', {
	unk1_0: t.uint32,
	unk1_1: t.uint32,
});

const Unknown0 = struct.packed(
	'QuestStaticData_Unknown0',
	{
		id: RefID,
		count: vsval,
		unknown1: array(Unknown1).countedBy(u => getVsval(u.count)),
	},
	{ isDynamic: true }
);

const QuestRunDataItem3Data = struct.packed(
	'QuestRunDataItem3Data',
	{
		type: t.uint32,
		unk_u32: array(primitive.types.uint32).countedBy(qd => (qd.type == 3 ? 1 : 0)),
		unk_refid: array(RefID).countedBy(qd => ([1, 2, 4].includes(qd.type) ? 1 : 0)),
	},
	{ isDynamic: true }
);

export const QuestRunDataItem3 = struct.packed(
	'QuestRunDataItem3',
	{
		unk1: t.uint32,
		unk2: t.float32,
		count: t.uint32,
		data: array(QuestRunDataItem3Data).countedBy('count'),
	},
	{ isDynamic: true }
);

export const QuestStaticData = struct.packed(
	'QuestStaticData',
	{
		count0: t.uint32,
		unk0: array(QuestRunDataItem3).countedBy('count0'),
		count1: t.uint32,
		unk1: array(QuestRunDataItem3).countedBy('count1'),
		count2: t.uint32,
		unk2: array(RefID).countedBy('count2'),
		count3: t.uint32,
		unk3: array(RefID).countedBy('count3'),
		count4: t.uint32,
		unk4: array(RefID).countedBy('count4'),
		count5: vsval,
		unk5: array(Unknown0).countedBy(u => getVsval(u.count5)),
		unk6: t.uint8,
	},
	{ isDynamic: true }
);
