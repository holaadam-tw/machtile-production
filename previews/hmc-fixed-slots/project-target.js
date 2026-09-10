(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HmcFixedProjectTarget=api;}(globalThis,function(){
  'use strict';
  // Deploy-target guard: the single hardcoded Supabase project this runtime is allowed to talk to.
  // THIS IS THE ONLY FILE THAT DIFFERS between the prototype (Dev) copy and this production copy.
  // Port by replacing these two literals; every other file is byte-identical across the two copies.
  // Never read this from config/env/localStorage: the guard exists so that a wrong config cannot
  // route staging RPCs, the storage journal, or the host gate at some other project.
  // ref = project reference (also the localStorage journal namespace); url = its exact origin, no trailing slash.
  return Object.freeze({ref:'muditjubqflrqofbkmav',url:'https://muditjubqflrqofbkmav.supabase.co'});
}));
