// Membership agreements (join flow) and guest liability waivers (guest
// flow), per gym. The signup pages render these, and the Stripe webhook
// snapshots the exact text a person signed onto their Member / GuestWaiver
// row — so a later edit here never changes what someone already signed.
//
// version = first 12 hex chars of sha256(text), where text is the plain-text
// rendering below. The page sends the version it showed; the webhook looks it
// up here. Editing a text gives it a new version.

const MEMBER_OASIS = [
  {
    title: 'Membership Agreement',
    body: 'This Membership Agreement is entered into as of the date signed below between the Member ("Member") and Oasis Powerlifting LLC ("Gym"). By signing this, the Member acknowledges and agrees to the following terms regarding membership cancellation and payment policies:',
  },
  {
    title: '1. Payments and Refunds',
    body: '1.1. All membership payments are final and non-refundable. This applies to payments made for the current billing cycle as well as any prior cycles.\n\n1.2. The Member understands and agrees that failure to use the Gym\'s facilities or services does not entitle them to a refund or credit.\n\n1.3. If any payment remains outstanding for more than 30 days, the Member\'s access to the Gym will be AUTOMATICALLY & IMMEDIATELY frozen until all outstanding fees are paid in full.',
  },
  {
    title: '2. Membership Cancellation Requests',
    body: '2.1. Cancellation requests must be submitted online through the Gym\'s official cancellation request form, which can be found on the Gym\'s website or provided upon request.\n\n2.2. To be effective for the upcoming billing cycle, all cancellation requests must be received by the Gym before the next billing cycle begins. Requests received after the billing cycle begins will be processed for the subsequent billing cycle.\n\n2.3. If a membership is canceled, any special pricing or benefits associated with the Member\'s account will be forfeited. Should the Member wish to sign up for a membership again, any applicable new pricing and fees may apply.\n\n2.4. If the Member plans to continue their membership in the near future but requires a temporary pause, the Gym offers membership freeze options. Members are encouraged to inquire about this alternative.',
  },
  {
    title: '3. Membership Termination by Gym',
    body: '3.1. Ownership reserves the right to cancel any Member\'s membership for any reason at any time.\n\n3.2. Memberships may also be terminated if the Member violates the Gym\'s rules or if their behavior does not contribute to the positive, supportive environment the Gym strives to maintain. In such cases, any pre-paid amounts for future billing cycles will be refunded.',
  },
  {
    title: '4. Recurring Billing Terms & Authorization',
    body: '4.1. By becoming a member of Oasis Powerlifting LLC, the Member agrees that all membership fees will be automatically billed on a recurring basis using the payment method provided. The billing cycle and amount will be determined based on the membership plan selected at the time of enrollment.\n\n4.2. Valid Payment Method Requirement: All Members are required to maintain a valid credit card or debit card on file at all times, regardless of the type or duration of membership purchased. The card on file will be used for monthly membership dues, as well as any other fees or charges associated with the Member\'s account (e.g., late fees, additional services, or merchandise purchases, if applicable). It is the Member\'s responsibility to ensure that the payment method on file remains current and valid. Members must promptly notify Oasis Gym of any changes to their payment details, such as a new card number or expiration date. Failure to do so may result in declined payments and additional fees.\n\n4.3. Failed Payments and Late Fees: If a recurring payment is declined or fails for any reason, the Member will be notified and must provide updated payment details within 7 days. If payment is not received within this timeframe, the management reserves the right of a one-time fine of $50.00 for each instance of late payment and risk having their membership temporarily suspended until the balance is paid.\n\n4.4. Agreement to Automated Charges: By signing this agreement, the Member authorizes Oasis Powerlifting LLC to charge the card on file for all recurring dues and fees, as outlined in the membership terms.\n\n4.5. Termination of Membership Due to Non-Payment: Failure to maintain an active, valid payment method or failure to resolve overdue balances within 30 days may result in the termination of the Member\'s contract. Any outstanding balances must be cleared before reactivating a membership or signing a new contract.',
  },
  {
    title: '5. Additional Terms',
    body: '5.1. Bringing a non-member who does not pay for a day pass or sign a waiver is strictly prohibited. Members who violate this policy will be subject to a $100 fine and will assume full liability for the non-member.\n\n5.2. Acknowledgment: By signing below, the Member acknowledges that they have read, understood, and agree to the terms outlined in this contract. The Member further agrees that these terms are binding.',
  },
]

const TRIUMPH_TERMS = [
  {
    title: '1. Member Access',
    body: "Access to Triumph Barbell is permitted only when payment for that day (or membership dues) has been made in advance.\n\nDo not open or close external windows unless authorized by staff.\n\nMembers are strictly prohibited from entering any other areas of the building (e.g. freight elevator, other tenants' spaces). Wandering into any spaces beyond Triumph Barbell is not allowed.",
  },
  {
    title: '2. Equipment & Facility Use; Damage Liability',
    body: "Members are responsible for any damage caused to equipment or the premises, except for normal wear and tear.\n\nCosts for repair or replacement due to deliberate or negligent damage will be charged directly to the responsible Member or their guest.\n\nUse of gym equipment and facilities is at the Member's own risk. Triumph Barbell is not liable for accidents, injuries, or damages unless caused by willful misconduct.",
  },
  {
    title: '3. Payment Terms & Entry Fees',
    body: "Any individual entering the facility must have an active membership or purchase a day pass prior to entering.\n\nNo exceptions: failure to pay entry fees before entry may result in fines (see Section 5).",
  },
  {
    title: '4. Facility Restrictions',
    body: "Members must stay within authorized areas. Use of freight elevators or entering other business spaces is strictly forbidden.\n\nViolation may result in suspension or termination of access rights.",
  },
  {
    title: '5. Sneaking In / Unpaid Entry Penalties',
    body: "First time sneaking in without paying: Members must pay a $15 penalty plus the standard day pass fee.\n\nSecond offense: $30 penalty plus the day pass fee.\n\nIf a Member sneaks in or allows someone else to enter without paying (as a member or a guest), a $50 fine is imposed on the Member permitting the unpaid entry.",
  },
  {
    title: '6. Rules & Responsibilities',
    body: "Members must adhere to all safety guidelines and posted rules.\n\nAppropriate attire and conduct are required at all times.\n\nUse of drugs, tobacco, alcohol, or other prohibited substances on the premises is strictly banned.\n\nLost personal items are the Member's responsibility. Triumph Barbell is not liable for any theft or loss.",
  },
  {
    title: '7. Assumption of Risk',
    body: "Members acknowledge the inherent risks associated with strength training, cardio workouts, and all other physical activities that may take place within the facility.\n\nBy signing below, the Member voluntarily assumes full responsibility for all such risks, including but not limited to injury, illness, disability, or death.",
  },
  {
    title: '8. Waiver of Liability',
    body: "To the fullest extent permitted by law, the Member releases and discharges Triumph Barbell, its owners, employees, contractors, and agents from any and all claims or liabilities for injuries, damages, or losses arising out of or related to the Member's use of the facility, including claims arising from the negligence (but not gross negligence or willful misconduct) of Triumph Barbell or its staff.",
  },
  {
    title: '9. Indemnification',
    body: "The Member agrees to indemnify and hold harmless Triumph Barbell, its owners, employees, and agents from any and all claims, demands, or causes of action brought by third parties, including guests, arising from the Member's actions, negligence, or violation of this agreement.",
  },
  {
    title: '10. Medical Acknowledgment & Emergency Authorization',
    body: "The Member affirms that they are in good physical condition and capable of participating in physical activity. The Member agrees to stop exercising if they experience pain, dizziness, or shortness of breath.\n\nIn the event of a medical emergency, the Member authorizes Triumph Barbell staff to seek emergency medical care on their behalf, and agrees to assume responsibility for any associated costs.",
  },
  {
    title: '11. Recording Notice & Media Release',
    body: "Triumph Barbell permits members to record their own training sessions for personal or social media use. By entering the facility, the Member understands and agrees that they may appear in the background of other members' photos or video recordings. Triumph Barbell is not responsible for the content or distribution of footage recorded by members.\n\nThe Member also grants Triumph Barbell the right to use photographs or video recordings taken by staff on-site for promotional or marketing purposes. Members who do not wish to appear in gym-owned content must notify staff in writing.",
  },
  {
    title: '12. Termination & Enforcement',
    body: "Triumph Barbell reserves the right to suspend or terminate membership for rule violations, unpaid fees, or any behavior deemed unsafe or disruptive.\n\nOutstanding charges must be paid in full before access is reinstated.",
  },
  {
    title: '13. Membership Cancellation / Freeze',
    body: "To cancel or freeze a membership, Members must complete and submit the official Membership Manager form, available via email request or Instagram DM.\n\nAll cancellations require a minimum of 30 days' notice prior to the next billing cycle.\n\nAny prepaid fees beyond the final access date may be refunded only as outlined in the plan terms. No exceptions will be made for failure to submit the required form or for insufficient notice.",
  },
  {
    title: '14. Minor Membership & Parental Consent',
    body: "Members under the age of 18 must have a parent or legal guardian co-sign this agreement. The guardian assumes full responsibility for the minor's conduct, safety, and adherence to all facility rules. Triumph Barbell does not provide supervision for minors.",
  },
  {
    title: '15. Governing Law & Dispute Resolution',
    body: "This agreement shall be governed under the laws of the Commonwealth of Massachusetts, where Triumph Barbell is located.\n\nAny disputes arising out of this agreement or use of the facility will first be attempted to be resolved through good-faith negotiation or mediation prior to any legal proceedings.",
  },
  {
    title: '16. Signature & Acknowledgment',
    body: "By signing below, the Member confirms that they have read, understood, and voluntarily agreed to all terms of this agreement, including the waiver of liability and assumption of risk.\n\nBy signing below, the Member acknowledges reading, understanding, and agreeing to abide by these Terms & Conditions.\n\nI understand & agree with the following conditions.",
  },
]

const MEMBER_HYDRA = [
  {
    title: 'Express Assumption of Risk',
    body: 'I, the undersigned, am aware that there are significant risks involved in any physical training regimen. These risks include, but are not limited to: falls which can result in serious injury or death, injury or death due to negligence on the part of me, my training partner, or other people around me, injury or death due to improper use or failure of equipment. Injury may also result simply from the fact of physical training itself. By its very nature, physical training seeks to have me push beyond my limits in order to produce a physical adaptation by my body. This requires feedback from me to my trainer regarding what is happening with my body. Excessive work can result (in rare cases) in exertional rhabdomyolysis. I should look for signs of excessive soreness, darkened urine, and pain in the kidney areas in the days following a particularly intense workout. While this type of injury is relatively rare, it can occur due to a number of factors, including (but not limited to) genetic predisposition or dehydration that may be beyond the control of my trainer. I am aware that any of these above mentioned risks might result in serious injury or death to me and or my partner(s). I willingly assume full responsibility for the risks that I am exposing myself to and accept full responsibility for any injury or death that may result from participation in any activity or class while training. I, the undersigned acknowledge that I have no physical impairments or illnesses that I know of that will endanger others or myself.',
  },
  {
    title: 'Release',
    body: 'In consideration of the above mentioned risks and hazards and in consideration of the fact that I am willingly and voluntarily participating in the activities available at Hydra Athletic Co. in-person or online, I, the undersigned hereby release Hydra Athletic Co., their principals, agents, employees, and volunteers from any and all liability, claims, demands, actions or rights of action, which are related to, arise out of, or are in any way connected with my participation in this activity, including those allegedly attributed to the negligent acts or omissions of the above mentioned parties.\n\nThis agreement shall be binding upon successors, my representatives, heirs, executors, assigns, transferees, or me. If any portion of this agreement is held invalid, I agree that the remainder of the agreement shall remain in full legal force and effect.',
  },
  {
    title: 'Equipment Use, Safety Waiver, and Member Negligence Release',
    body: 'I expressly acknowledge that the use of strength training equipment, free weights, machines, squat racks, platforms, cables, resistance systems, specialty bars, attachments, and all other fitness equipment at Hydra Athletic Co. involves inherent and substantial risks of serious bodily injury, permanent disability, paralysis, or death. These risks exist regardless of the presence of staff, posted instructions, or safety features.\n\nI acknowledge that safety mechanisms may be available on certain equipment, including but not limited to safety arms, spotter arms, rack pins, safety bars, collars, clips, catches, and other protective devices. I understand and agree that it is solely my responsibility to properly set up, inspect, and utilize all safety mechanisms before engaging in any lift or activity.\n\nI expressly agree that failure to properly use available safety mechanisms, improper loading of equipment, lifting beyond my physical capacity, failure to secure weights or collars, failure to use a spotter when reasonably necessary, misuse of equipment, distraction, impairment, fatigue, reckless conduct, or failure to follow staff instruction constitutes my own negligence and assumption of risk.\n\nSpotter Acknowledgment. I acknowledge that Hydra Athletic Co. does not provide spotters unless expressly agreed to by an authorized employee or coach. It is solely my responsibility to determine whether a spotter is necessary for any exercise I choose to perform. If I elect to perform any lift without a spotter, I voluntarily assume all risks associated with that decision, including the risk of serious bodily injury, permanent disability, or death.\n\nTo the fullest extent permitted by law, I hereby RELEASE, WAIVE, DISCHARGE, AND COVENANT NOT TO SUE Hydra Athletic Co. and its owners, officers, employees, agents, and affiliates from any and all claims, liabilities, demands, causes of action, damages, costs, or expenses arising out of or related to misuse of equipment, failure to use safety mechanisms, or my own negligent conduct.',
  },
  {
    title: 'Photo and Video Release',
    body: 'I hereby grant Hydra Athletic Co. permission to use my photograph/video image in any and all publications for Hydra Athletic Co., including website entries, without payment or any other consideration in perpetuity. I hereby authorize Hydra Athletic Co. to edit, alter, copy, exhibit, publish or distribute all photos and images. I waive the right to inspect or approve the finished product. Additionally, I waive any right to royalties or other compensation arising or related to the use of the photograph or video images.',
  },
  {
    title: 'Gym Membership Payment Terms',
    body: 'I understand that membership commences on the date of sign up and the membership fee will be charged every four (4) weeks from my initial sign up unless otherwise noted. All memberships paid every four (4) weeks are non-refundable in part or full after auto-draft has gone through under any circumstances. All memberships are subject to Hydra Athletic Co. annual maintenance fee of $29.99 on January 30th each year. Memberships paid upfront are not refundable under any circumstances. All memberships will renew automatically regardless of if it\'s a weekly, monthly, or annual membership.\n\nFor cancellations, holds, and/or changes to memberships for any reason, member must notify Hydra Athletic Co. via email or in person through management at least 30 days prior to the next auto-draft. If you are cancelling a 12 month contract agreement, fees may apply: $150 before your 6 month mark and $95 after your 6 month mark.\n\nMembership upgrades to a higher price will not be subject to any fees. Membership downgrades to a lower price will be subject to all new expiration and cancellation dates, terms & fees applying, including registration and early cancellation fees. Membership rates are subject to change.',
  },
  {
    title: 'Day Pass Policy',
    body: 'Day passes grant access to Hydra Athletic Co. for a 24-hour period. A guest pass may only be used and assigned to a single individual. Any misuse of Day Pass policies may result in extra fees or banning from the premises. Please note that day passes provide access to the main gym floor only and do not include use of the recovery lounge or any recovery room amenities.',
  },
  {
    title: 'Facility Access and Anti-Tailgating Policy',
    body: 'Access credentials, key fobs, mobile credentials, door codes, or any other method of entry issued by Hydra Athletic Co. are assigned exclusively to the individual Member and may not be shared, loaned, transferred, duplicated, or used to admit any other person into the facility. Members shall not permit any individual to enter the facility by following them through a secured entrance ("tailgating" or "piggybacking") unless that individual has independently obtained authorized access or has been properly checked in as a guest. Any violation of this policy may result in immediate suspension or termination of membership, revocation of 24-hour access privileges, and assessment of applicable fees or damages.',
  },
  {
    title: 'Personal Belongings Policy',
    body: 'Hydra Athletic Co. is not responsible for any lost, stolen, or misplaced personal items within the facility, including but not limited to items left on the gym floor, in locker rooms, or in common areas. Members and visitors are strongly encouraged to secure all personal belongings in a locker and use a personal lock at all times while in the facility. Any items left unattended are done so at the individual\'s own risk. Hydra Athletic Co. assumes no liability for the loss, theft, or damage of personal property under any circumstances.',
  },
  {
    title: 'Minor Membership Policy',
    body: 'Members under the age of eighteen (18) may participate in Hydra Athletic Co. programs only with the written consent of a parent or legal guardian. The parent or legal guardian represents that they have the legal authority to execute this Agreement on behalf of the minor and agrees to all terms, conditions, waivers, releases, and obligations contained herein, both individually and on behalf of the minor participant.',
  },
  {
    title: 'Cancellation Policy for Online Coaching and Personal Training Services',
    body: 'All coaching plans continue month-to-month indefinitely until you submit a written cancellation request. If a Personal Training Package is purchased, it cannot be refunded. Client no-shows can result in an extra charge determined by the Personal Trainer. Clients may cancel their coaching or training plan at any time after the package period has been fulfilled.\n\nClient acknowledges that assignment to a specific personal trainer/coach is not guaranteed for the duration of this Agreement. If the assigned trainer/coach becomes unavailable for any reason, Hydra may reassign Client to another qualified trainer/coach at the same rate. Such reassignment shall not constitute a breach of this Agreement and does not entitle Client to a refund, credit, or cancellation.\n\nSession Cancellation Policy: Clients must provide at least 12 hours\' notice to cancel or reschedule a coaching session. Failure to do so will result in the session being counted as used and charged accordingly.',
  },
  {
    title: 'Gym Policy',
    body: 'Hydra Athletic Co. is committed to providing a safe environment for all its employees free from discrimination on any ground and from harassment at work including sexual harassment. Hydra Athletic Co. will operate a zero tolerance policy for any form of sexual harassment in the workplace. Any person found to have sexually harassed another will face disciplinary action, up to and including dismissal from employment or termination of membership.\n\nHydra Athletic Co. has a zero tolerance policy on being disrespectful to the gym itself, other members, or staff. Violation of this policy can result in membership termination, damage fine, and refusal of service. Hydra Athletic Co. has the right to terminate any membership at any point in time if deemed necessary by management/ownership.',
  },
  {
    title: 'Marketing Consent Policy',
    body: 'By signing below, you explicitly consent to receive marketing communications from Hydra Athletic Co. via email and SMS. These communications may include promotional offers and discounts, product updates and announcements, newsletters, and special events.\n\nYou may unsubscribe from marketing emails at any time by clicking the "unsubscribe" link in any email. To opt out of SMS messages, reply with "STOP" to any message you receive.',
  },
  {
    title: 'Waiver of Liability and Hold Harmless Agreement',
    body: 'In consideration for receiving permission (24/7 access) to be on premises at Hydra Athletic Co., I hereby acknowledge and agree to indemnify, defend and hold harmless Hydra Athletic Co. and all related parties from and against any and all claims, demands, suits, judgments, losses or expenses of any nature whatsoever (including attorneys\' fees), arising from or out of, or relating to, directly or indirectly, the infection of COVID-19 or any other illness or injury.\n\nIN SIGNING THIS AGREEMENT, I ACKNOWLEDGE AND REPRESENT THAT I have read the foregoing Waiver of Liability and Hold Harmless Agreement, understand it and sign it voluntarily as my own free act and deed. I am at least eighteen (18) years of age and fully competent, and I execute this Agreement for full, adequate and complete consideration fully intending to be bound by same.\n\nThis waiver & agreement applies for Hydra Athletic Co. in-person and online coaching services including training and nutrition.',
  },
  {
    title: 'Pre-Sale Membership Addendum',
    body: 'By enrolling in the Hydra Athletic Co. Pre-Sale Membership, the Member acknowledges and agrees that the promotional membership rate of Fifty Dollars ($50.00) every four (4) weeks is offered exclusively in exchange for a minimum commitment of twelve (12) consecutive months from the Member\'s enrollment date.\n\nThe promotional membership rate shall remain fixed for the initial twelve (12) month commitment period, provided the Member remains in good standing. Any cancellation prior to the expiration of the initial commitment period shall be subject to the applicable early termination provisions.\n\nUpon completion of the initial twelve (12) month commitment period, the membership shall automatically continue on a recurring four (4) week billing cycle at Hydra Athletic Co.\'s then-current membership rate unless cancelled in accordance with the Membership Agreement.',
  },
]

const GUEST_OASIS = [
  {
    title: 'Liability Waiver',
    body: 'In consideration of my use in the exercise equipment and facilities by Oasis Powerlifting LLC, I expressly agree and contract on behalf of myself, my heirs, executors, administrators, successors and assigns, that Oasis Powerlifting LLC and its insurers, employees, officers, directors, and associates shall not be liable from any damages arising from personal injuries (including death) sustained by me, or my guest in, on, or about the premises, or as a result in the use in the equipment or facilities, regardless of whether such injuries result, in whole or in part, from the negligence Oasis Powerlifting LLC.',
  },
]

const GUEST_HYDRA = [
  {
    title: 'Express Assumption of Risk',
    body: 'I, the undersigned, am aware that there are significant risks involved in any physical training regimen. These risks include, but are not limited to: falls which can result in serious injury or death, injury or death due to negligence on the part of me, my training partner, or other people around me, injury or death due to improper use or failure of equipment. Injury may also result simply from the fact of physical training itself. By its very nature, physical training seeks to have me push beyond my limits in order to produce a physical adaptation by my body. This requires feedback from me to my trainer regarding what is happening with my body. Excessive work can result (in rare cases) in exertional rhabdomyolysis. I should look for signs of excessive soreness, darkened urine, and pain in the kidney areas in the days following a particularly intense workout. While this type of injury is relatively rare, it can occur due to a number of factors, including (but not limited to) genetic predisposition or dehydration that may be beyond the control of my trainer. I am aware that any of these above mentioned risks might result in serious injury or death to me and or my partner(s). I willingly assume full responsibility for the risks that I am exposing myself to and accept full responsibility for any injury or death that may result from participation in any activity or class while training. I, the undersigned acknowledge that I have no physical impairments or illnesses that I know of that will endanger others or myself.',
  },
  {
    title: 'Release',
    body: 'In consideration of the above mentioned risks and hazards and in consideration of the fact that I am willingly and voluntarily participating in the activities available at Hydra Athletic Co. in-person or online, I, the undersigned hereby release Hydra Athletic Co., their principals, agents, employees, and volunteers from any and all liability, claims, demands, actions or rights of action, which are related to, arise out of, or are in any way connected with my participation in this activity, including those allegedly attributed to the negligent acts or omissions of the above mentioned parties.\n\nThis agreement shall be binding upon successors, my representatives, heirs, executors, assigns, transferees, or me. If any portion of this agreement is held invalid, I agree that the remainder of the agreement shall remain in full legal force and effect.',
  },
  {
    title: 'Equipment Use, Safety Waiver, and Member Negligence Release',
    body: 'I expressly acknowledge that the use of strength training equipment, free weights, machines, squat racks, platforms, cables, resistance systems, specialty bars, attachments, and all other fitness equipment at Hydra Athletic Co. involves inherent and substantial risks of serious bodily injury, permanent disability, paralysis, or death. These risks exist regardless of the presence of staff, posted instructions, or safety features.\n\nI acknowledge that safety mechanisms may be available on certain equipment, including but not limited to safety arms, spotter arms, rack pins, safety bars, collars, clips, catches, and other protective devices. I understand and agree that it is solely my responsibility to properly set up, inspect, and utilize all safety mechanisms before engaging in any lift or activity.\n\nI expressly agree that failure to properly use available safety mechanisms, improper loading of equipment, lifting beyond my physical capacity, failure to secure weights or collars, failure to use a spotter when reasonably necessary, misuse of equipment, distraction, impairment, fatigue, reckless conduct, or failure to follow staff instruction constitutes my own negligence and assumption of risk.\n\nSpotter Acknowledgment. I acknowledge that Hydra Athletic Co. does not provide spotters unless expressly agreed to by an authorized employee or coach. It is solely my responsibility to determine whether a spotter is necessary for any exercise I choose to perform. If I elect to perform any lift without a spotter, I voluntarily assume all risks associated with that decision, including the risk of serious bodily injury, permanent disability, or death.\n\nTo the fullest extent permitted by law, I hereby RELEASE, WAIVE, DISCHARGE, AND COVENANT NOT TO SUE Hydra Athletic Co. and its owners, officers, employees, agents, and affiliates from any and all claims, liabilities, demands, causes of action, damages, costs, or expenses arising out of or related to misuse of equipment, failure to use safety mechanisms, or my own negligent conduct.',
  },
  {
    title: 'Photo and Video Release',
    body: 'I hereby grant Hydra Athletic Co. permission to use my photograph/video image in any and all publications for Hydra Athletic Co., including website entries, without payment or any other consideration in perpetuity. I hereby authorize Hydra Athletic Co. to edit, alter, copy, exhibit, publish or distribute all photos and images. I waive the right to inspect or approve the finished product. Additionally, I waive any right to royalties or other compensation arising or related to the use of the photograph or video images.',
  },
  {
    title: 'Gym Membership Payment Terms',
    body: 'I understand that membership commences on the date of sign up and the membership fee will be charged every four (4) weeks from my initial sign up unless otherwise noted. All memberships paid every four (4) weeks are non-refundable in part or full after auto-draft has gone through under any circumstances. All memberships are subject to Hydra Athletic Co. annual maintenance fee of $29.99 on January 30th each year. Memberships paid upfront are not refundable under any circumstances. All memberships will renew automatically regardless of if it\'s a weekly, monthly, or annual membership.\n\nFor cancellations, holds, and/or changes to memberships for any reason, member must notify Hydra Athletic Co. via email or in person through management at least 30 days prior to the next auto-draft. If you are cancelling a 12 month contract agreement, fees may apply: $150 before your 6 month mark and $95 after your 6 month mark.\n\nMembership upgrades to a higher price will not be subject to any fees. Membership downgrades to a lower price will be subject to all new expiration and cancellation dates, terms & fees applying, including registration and early cancellation fees. Membership rates are subject to change.',
  },
  {
    title: 'Day Pass Policy',
    body: 'Day passes grant access to Hydra Athletic Co. for a 24-hour period. A guest pass may only be used and assigned to a single individual. Any misuse of Day Pass policies may result in extra fees or banning from the premises. Please note that day passes provide access to the main gym floor only and do not include use of the recovery lounge or any recovery room amenities.',
  },
  {
    title: 'Facility Access and Anti-Tailgating Policy',
    body: 'Access credentials, key fobs, mobile credentials, door codes, or any other method of entry issued by Hydra Athletic Co. are assigned exclusively to the individual Member and may not be shared, loaned, transferred, duplicated, or used to admit any other person into the facility. Members shall not permit any individual to enter the facility by following them through a secured entrance ("tailgating" or "piggybacking") unless that individual has independently obtained authorized access or has been properly checked in as a guest. Any violation of this policy may result in immediate suspension or termination of membership, revocation of 24-hour access privileges, and assessment of applicable fees or damages.',
  },
  {
    title: 'Personal Belongings Policy',
    body: 'Hydra Athletic Co. is not responsible for any lost, stolen, or misplaced personal items within the facility, including but not limited to items left on the gym floor, in locker rooms, or in common areas. Members and visitors are strongly encouraged to secure all personal belongings in a locker and use a personal lock at all times while in the facility. Any items left unattended are done so at the individual\'s own risk. Hydra Athletic Co. assumes no liability for the loss, theft, or damage of personal property under any circumstances.',
  },
  {
    title: 'Minor Membership Policy',
    body: 'Members under the age of eighteen (18) may participate in Hydra Athletic Co. programs only with the written consent of a parent or legal guardian. The parent or legal guardian represents that they have the legal authority to execute this Agreement on behalf of the minor and agrees to all terms, conditions, waivers, releases, and obligations contained herein, both individually and on behalf of the minor participant.',
  },
  {
    title: 'Cancellation Policy for Online Coaching and Personal Training Services',
    body: 'All coaching plans continue month-to-month indefinitely until you submit a written cancellation request. If a Personal Training Package is purchased, it cannot be refunded. Client no-shows can result in an extra charge determined by the Personal Trainer. Clients may cancel their coaching or training plan at any time after the package period has been fulfilled.\n\nClient acknowledges that assignment to a specific personal trainer/coach is not guaranteed for the duration of this Agreement. If the assigned trainer/coach becomes unavailable for any reason, Hydra may reassign Client to another qualified trainer/coach at the same rate. Such reassignment shall not constitute a breach of this Agreement and does not entitle Client to a refund, credit, or cancellation.\n\nSession Cancellation Policy: Clients must provide at least 12 hours\' notice to cancel or reschedule a coaching session. Failure to do so will result in the session being counted as used and charged accordingly.',
  },
  {
    title: 'Gym Policy',
    body: 'Hydra Athletic Co. is committed to providing a safe environment for all its employees free from discrimination on any ground and from harassment at work including sexual harassment. Hydra Athletic Co. will operate a zero tolerance policy for any form of sexual harassment in the workplace. Any person found to have sexually harassed another will face disciplinary action, up to and including dismissal from employment or termination of membership.\n\nHydra Athletic Co. has a zero tolerance policy on being disrespectful to the gym itself, other members, or staff. Violation of this policy can result in membership termination, damage fine, and refusal of service. Hydra Athletic Co. has the right to terminate any membership at any point in time if deemed necessary by management/ownership.',
  },
  {
    title: 'Marketing Consent Policy',
    body: 'By signing below, you explicitly consent to receive marketing communications from Hydra Athletic Co. via email and SMS. These communications may include promotional offers and discounts, product updates and announcements, newsletters, and special events.\n\nYou may unsubscribe from marketing emails at any time by clicking the "unsubscribe" link in any email. To opt out of SMS messages, reply with "STOP" to any message you receive.',
  },
  {
    title: 'Waiver of Liability and Hold Harmless Agreement',
    body: 'In consideration for receiving permission (24/7 access) to be on premises at Hydra Athletic Co., I hereby acknowledge and agree to indemnify, defend and hold harmless Hydra Athletic Co. and all related parties from and against any and all claims, demands, suits, judgments, losses or expenses of any nature whatsoever (including attorneys\' fees), arising from or out of, or relating to, directly or indirectly, the infection of COVID-19 or any other illness or injury.\n\nIN SIGNING THIS AGREEMENT, I ACKNOWLEDGE AND REPRESENT THAT I have read the foregoing Waiver of Liability and Hold Harmless Agreement, understand it and sign it voluntarily as my own free act and deed. I am at least eighteen (18) years of age and fully competent, and I execute this Agreement for full, adequate and complete consideration fully intending to be bound by same.\n\nThis waiver & agreement applies for Hydra Athletic Co. in-person and online coaching services including training and nutrition.',
  },
]

// Gyms without their own text get Triumph's terms (as they always have)
const SECTIONS = {
  member: {
    'oasis-boston':      MEMBER_OASIS,
    'triumph-barbell':   TRIUMPH_TERMS,
    'hydra-athletic-co': MEMBER_HYDRA,
  },
  guest: {
    'oasis-boston':      GUEST_OASIS,
    'hydra-athletic-co': GUEST_HYDRA,
  },
}

/**
 * The agreement sections ({ title?, body }[]) shown for this gym and flow.
 * @param {string} gymSlug
 * @param {'member' | 'guest'} flow
 */
export function agreementSections(gymSlug, flow) {
  return SECTIONS[flow]?.[gymSlug] ?? TRIUMPH_TERMS
}

/** Plain-text rendering of the sections — what gets snapshotted and hashed. */
export function agreementText(gymSlug, flow) {
  return agreementSections(gymSlug, flow)
    .map(s => (s.title ? `${s.title}\n\n${s.body}` : s.body))
    .join('\n\n')
}

/** Short sha256 of a text (WebCrypto — same result in the browser and on the server). */
async function shortSha256(text) {
  const bytes  = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

/** Version of the text currently shown for this gym and flow. */
export async function agreementVersion(gymSlug, flow) {
  return shortSha256(agreementText(gymSlug, flow))
}

/**
 * The text to snapshot for a signature: the text matching `version` if it's
 * the one currently shown for this gym and flow; otherwise (unknown or
 * missing version — e.g. the text was edited between page load and payment)
 * the current text, with matched: false so the caller can log it.
 *
 * @returns {Promise<{ text: string, version: string, matched: boolean }>}
 */
export async function resolveAgreement(gymSlug, flow, version) {
  const text    = agreementText(gymSlug, flow)
  const current = await shortSha256(text)
  return { text, version: current, matched: Boolean(version) && version === current }
}
