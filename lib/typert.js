// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
import {z} from 'zod';
const schema=z.string().max(75*1024*1024);
const codec={mode:'strict',typeSymbol:'dsh-literature#json-string',schema,create:()=>schema};
export const TYPERT={package:'dsh-literature',face:'host',schemas:[],model:{services:[],events:[],objects:[]},invocations:[{
 id:'dsh-literature#literature/dispatch',service:'literature',namespace:'literature',method:'dispatch',invocation:{kind:'direct'},
 parameters:[{name:'request',wire:'request',source:'json',codec}],result:codec
}]};
